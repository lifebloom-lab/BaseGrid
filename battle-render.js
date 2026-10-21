import { battleCounts, layoutBattleZones } from './battle-model.js?v=20261021-reserve';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const HEADER = 108;

// Shared vector strokes keep the editor icons and exported PNG consistent.
const ROLE_PATHS = {
  main: [
    [['M',14.5,17.5],['L',3,6],['L',3,3],['L',6,3],['L',17.5,14.5]],
    [['M',13,19],['L',19,13]], [['M',16,16],['L',20,20]], [['M',19,21],['L',21,19]],
    [['M',14.5,6.5],['L',18,3],['L',21,3],['L',21,6],['L',17.5,9.5]],
    [['M',5,14],['L',10,19]], [['M',7,17],['L',4,20]], [['M',3,19],['L',5,21]],
  ],
  reserve: [
    [['M',20,11],['C',19.5,6,14,3,9.5,5],['C',7.5,6,6,7.5,5,9]],
    [['M',5,4],['L',5,9],['L',10,9]],
    [['M',4,13],['C',4.5,18,10,21,14.5,19],['C',16.5,18,18,16.5,19,15]],
    [['M',19,20],['L',19,15],['L',14,15]],
  ],
};
export function battleRoleIcon(reserve = false) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(key, value);
  for (const commands of ROLE_PATHS[reserve ? 'reserve' : 'main']) {
    const path = document.createElementNS(icon.namespaceURI, 'path');
    path.setAttribute('d', commands.map(command => command.join(' ')).join(' ')); icon.append(path);
  }
  return icon;
}
function drawRoleIcon(ctx, reserve, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const commands of ROLE_PATHS[reserve ? 'reserve' : 'main']) {
    ctx.beginPath();
    for (const [command, ...points] of commands) ctx[{ M: 'moveTo', L: 'lineTo', C: 'bezierCurveTo' }[command]](...points);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDesertTitle(ctx, width, height) {
  // Cover the template's blank title area; draw in shared map/export coordinates.
  ctx.save();
  ctx.translate(width * .017, HEADER + height * .017);
  ctx.scale(width * .314 / 800, height * .078 / 208);
  const frame = ctx.createLinearGradient(0, 0, 800, 208);
  frame.addColorStop(0, '#fff0b2');
  frame.addColorStop(.35, '#ce8b36');
  frame.addColorStop(.7, '#f2c66c');
  frame.addColorStop(1, '#875022');
  ctx.fillStyle = frame;
  ctx.shadowColor = '#190d09aa'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
  ctx.fillRect(0, 0, 800, 208);
  ctx.shadowColor = 'transparent';
  const background = ctx.createLinearGradient(0, 0, 0, 208);
  background.addColorStop(0, '#453125');
  background.addColorStop(.5, '#231e1a');
  background.addColorStop(1, '#111919');
  ctx.fillStyle = background;
  ctx.fillRect(5, 5, 790, 198);
  // Subtle diagonal engraving gives the plaque texture without competing with names.
  ctx.strokeStyle = '#f1be6410'; ctx.lineWidth = 1;
  for (let x = 20; x < 750; x += 24) {
    ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x + 40, 192); ctx.stroke();
  }
  ctx.strokeStyle = '#d5a455'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 14); ctx.lineTo(772, 14); ctx.lineTo(786, 28);
  ctx.lineTo(786, 180); ctx.lineTo(772, 194); ctx.lineTo(28, 194);
  ctx.lineTo(14, 180); ctx.lineTo(14, 28); ctx.closePath(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d9b775'; ctx.font = '700 18px ' + FONT;
  ctx.fillText('B A T T L E   P L A N', 400, 44);
  ctx.strokeStyle = '#b78542'; ctx.lineWidth = 2;
  for (const [start, end] of [[60, 264], [536, 740]]) {
    ctx.beginPath(); ctx.moveTo(start, 44); ctx.lineTo(end, 44); ctx.stroke();
  }
  const lettering = ctx.createLinearGradient(0, 78, 0, 150);
  lettering.addColorStop(0, '#fff6cc');
  lettering.addColorStop(.45, '#ffd877');
  lettering.addColorStop(1, '#dc802b');
  ctx.font = '900 80px "Arial Narrow", Impact, sans-serif';
  ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = '#130e0b';
  ctx.shadowColor = '#000c'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 5;
  ctx.strokeText('DESERT STORM', 400, 117, 704);
  ctx.fillStyle = lettering;
  ctx.fillText('DESERT STORM', 400, 117, 704);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = frame;
  ctx.fillRect(252, 176, 120, 2); ctx.fillRect(428, 176, 120, 2);
  ctx.beginPath(); ctx.moveTo(400, 169); ctx.lineTo(408, 177);
  ctx.lineTo(400, 185); ctx.lineTo(392, 177); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function drawBattle(map, plan, image, { editing = false, displayWidth = image.naturalWidth } = {}) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measure = (name, size) => { ctx.font = '600 ' + size + 'px ' + FONT; return ctx.measureText(name).width; };
  const measureWithRole = (name, size) => measure(name, size) + size * 1.15;
  // Three capsule rows, the power summary, and the add button in screen pixels.
  const minimumCardBody = editing ? 120 * width / Math.max(1, displayWidth) : 0;
  const zones = layoutBattleZones(map, plan, width, height, measureWithRole, { minimumCardBody }).map(zone => ({ ...zone, y: zone.y + HEADER }));
  const counts = battleCounts(plan);
  canvas.width = width;
  canvas.height = height + HEADER;
  ctx.fillStyle = '#152326';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, HEADER);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eff5f2';
  // Long titles stay on one line without colliding with the assignment count.
  const title = plan.title.trim() || 'Team A';
  let titleSize = 42;
  while (titleSize > 20 && measure(title, titleSize) > width - 570) titleSize -= 2;
  ctx.font = '600 ' + titleSize + 'px ' + FONT;
  ctx.fillText(title, 36, HEADER / 2, width - 570);
  ctx.font = '500 28px ' + FONT;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#b0c7c0';
  const hasReserves = plan.players.some(player => player.reserve);
  ctx.fillText(plan.players.length ? counts.assigned + ' / ' + plan.players.length + ' assigned · BaseGrid' : counts.alliesZones ? 'Allies · BaseGrid' : 'BaseGrid', width - 32, hasReserves ? 32 : HEADER / 2);
  if (hasReserves) {
    ctx.textAlign = 'left'; ctx.font = '500 26px ' + FONT;
    for (const [reserve, label, x, color] of [[false, 'Main', width - 310, '#a5e4c7'], [true, 'Reserve', width - 170, '#dcc0ff']]) {
      ctx.fillStyle = color; drawRoleIcon(ctx, reserve, x, 64, 28); ctx.fillText(label, x + 36, 78);
    }
  }
  ctx.textAlign = 'center';
  if (map.id === 'desert') drawDesertTitle(ctx, width, height);
  for (const zone of zones) {
    if (!zone.card && !zone.names.length) continue;
    if (zone.card) {
      // Replace the original fixed label with a header and an expanding body.
      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
      ctx.fillStyle = zone.card.color;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.headerHeight);
      ctx.fillStyle = '#fff';
      ctx.font = '750 ' + 30 * width / 2496 + 'px ' + FONT;
      ctx.fillText(zone.card.label, zone.x + zone.w / 2, zone.y + zone.headerHeight / 2, zone.w - zone.padding * 2);
      ctx.strokeStyle = '#46322180'; ctx.lineWidth = 2;
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
    }
    // The editor overlays interactive name capsules; exports draw names only.
    if (editing) continue;
    const textX = zone.x + zone.padding;
    const textY = zone.y + zone.headerHeight + zone.padding;
    ctx.fillStyle = '#142b23';
    if (zone.text.overflow) {
      const text = 'Names need more room';
      ctx.fillStyle = '#9b302d';
      ctx.font = '700 34px ' + FONT;
      ctx.fillText(text, zone.x + zone.w / 2, zone.y + (zone.h + zone.headerHeight) / 2, zone.w - zone.padding * 2);
    } else {
      ctx.strokeStyle = '#142b231a'; ctx.lineWidth = 1;
      for (const y of zone.text.rowDividers) {
        ctx.beginPath(); ctx.moveTo(textX, textY + y);
        ctx.lineTo(zone.x + zone.w - zone.padding, textY + y); ctx.stroke();
      }
      ctx.font = '600 ' + zone.text.fontSize + 'px ' + FONT;
      for (const [index, item] of zone.text.items.entries()) {
        const player = plan.players.find(player => player.id === plan.assignments[zone.id]?.[index]);
        const inset = player ? zone.text.fontSize * 1.15 : 0;
        const lineWidth = Math.max(...item.lines.map(line => measure(line, zone.text.fontSize)));
        ctx.fillStyle = player?.reserve ? '#64318d' : '#142b23';
        if (player) drawRoleIcon(ctx, player.reserve, textX + item.x - (lineWidth + inset) / 2, textY + item.y - zone.text.fontSize * .45, zone.text.fontSize * .9);
        item.lines.forEach((line, lineIndex) => ctx.fillText(line, textX + item.x + inset / 2, textY + item.y + lineIndex * zone.text.lineHeight));
      }
    }
  }
  return { canvas, zones, ...counts, imageWidth: width, imageHeight: height + HEADER,
    overflow: zones.filter(zone => zone.text.overflow) };
}

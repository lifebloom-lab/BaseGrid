import { layoutBattleZones } from './battle-model.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const HEADER = 108;

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

export function drawBattle(map, plan, image) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measure = (name, size) => { ctx.font = '600 ' + size + 'px ' + FONT; return ctx.measureText(name).width; };
  const zones = layoutBattleZones(map, plan, width, height, measure).map(zone => ({ ...zone, y: zone.y + HEADER }));
  const assigned = zones.reduce((sum, zone) => sum + zone.names.length, 0);
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
  ctx.fillText(assigned + ' / ' + plan.players.length + ' assigned · BaseGrid', width - 32, HEADER / 2);
  ctx.textAlign = 'center';
  if (map.id === 'desert') drawDesertTitle(ctx, width, height);
  for (const zone of zones) {
    if (!zone.card && !zone.names.length) continue;
    ctx.fillStyle = zone.card ? '#fffdf8' : '#fffffff2';
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    if (zone.card) {
      // Replace the original fixed label with a header and an expanding body.
      ctx.fillStyle = zone.card.color;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.headerHeight);
      ctx.fillStyle = '#fff';
      ctx.font = '750 ' + 30 * width / 2496 + 'px ' + FONT;
      ctx.fillText(zone.card.label, zone.x + zone.w / 2, zone.y + zone.headerHeight / 2, zone.w - zone.padding * 2);
      ctx.strokeStyle = '#46322180'; ctx.lineWidth = 2;
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
    }
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
      for (const item of zone.text.items) {
        item.lines.forEach((line, index) => ctx.fillText(line, textX + item.x, textY + item.y + index * zone.text.lineHeight));
      }
    }
  }
  return { canvas, zones, assigned, imageWidth: width, imageHeight: height + HEADER,
    overflow: zones.filter(zone => zone.text.overflow) };
}

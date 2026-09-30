export const MESSAGE_LANGUAGES = [
  { id: 'en', flag: '🇬🇧', name: 'English', label: 'English' },
  { id: 'es', flag: '🇪🇸', name: 'Español', label: 'Español (Spanish)' },
  { id: 'pt-BR', flag: '🇧🇷', name: 'Português (Brasil)', label: 'Português (Brasil) — Brazilian Portuguese' },
  { id: 'fr', flag: '🇫🇷', name: 'Français', label: 'Français (French)' },
  { id: 'ko', flag: '🇰🇷', name: '한국어', label: '한국어 (Korean)' },
  { id: 'de', flag: '🇩🇪', name: 'Deutsch', label: 'Deutsch (German)' },
  { id: 'ja', flag: '🇯🇵', name: '日本語', label: '日本語 (Japanese)' },
  { id: 'zh-CN', flag: '🇨🇳', name: '简体中文', label: '简体中文 (Simplified Chinese)' },
];

const templates = {
  en: (name, x, y) => `Hi ${name}! Please move your base to X: ${x}, Y: ${y} for our alliance formation.\nLet me know when you're in position. Thanks!`,
  es: (name, x, y) => `¡Hola, ${name}! Por favor, mueve tu base a X: ${x}, Y: ${y} para organizar la formación de nuestra alianza.\nAvísame cuando estés en tu posición. ¡Gracias!`,
  'pt-BR': (name, x, y) => `Olá, ${name}! Por favor, mova sua base para X: ${x}, Y: ${y} para organizar a formação da nossa aliança.\nMe avise quando estiver na posição. Obrigado!`,
  fr: (name, x, y) => `Salut ${name} ! Peux-tu déplacer ta base en X : ${x}, Y : ${y} pour la formation de notre alliance ?\nPréviens-moi quand tu es en place. Merci !`,
  ko: (name, x, y) => `${name}님, 안녕하세요! 연맹 대형을 맞추기 위해 기지를 X: ${x}, Y: ${y} 좌표로 이동해 주세요.\n이동을 완료하면 알려 주세요. 감사합니다!`,
  de: (name, x, y) => `Hallo ${name}! Bitte verschiebe deine Basis für unsere Allianzformation nach X: ${x}, Y: ${y}.\nGib mir Bescheid, wenn du an deinem Platz bist. Danke!`,
  ja: (name, x, y) => `${name}さん、こんにちは！同盟の配置を整えるため、基地を X: ${x}, Y: ${y} に移動してください。\n移動が完了したら教えてください。ありがとうございます！`,
  'zh-CN': (name, x, y) => `${name}，你好！为了配合联盟布局，请将基地迁移到 X: ${x}, Y: ${y}。\n到位后请告诉我，谢谢！`,
};

export const MESSAGE_LANGUAGE_KEY = 'basegrid.message-language.v1';
const supportedLanguage = value => MESSAGE_LANGUAGES.some(language => language.id === value) ? value : 'en';

/** Use the selected player's current coordinates. */
export function formatPlacementMessage(proposal, language = 'en') {
  if (!proposal) return '';
  return templates[supportedLanguage(language)](proposal.player.name, proposal.x, proposal.y);
}

export function loadMessageLanguage(storage) {
  try { return supportedLanguage(storage.getItem(MESSAGE_LANGUAGE_KEY)); }
  catch { return 'en'; }
}

export function saveMessageLanguage(storage, language) {
  storage.setItem(MESSAGE_LANGUAGE_KEY, supportedLanguage(language));
}

export function setupPlacementMessages({ onCopy = () => {} } = {}) {
  const panel = document.getElementById('player-message-panel');
  const picker = document.getElementById('message-languages');
  const message = document.getElementById('player-message');
  const copy = document.getElementById('copy-player-message');
  const status = document.getElementById('message-copy-status');
  let language = 'en';
  try { language = loadMessageLanguage(window.localStorage); } catch { /* Storage can be disabled. */ }
  let proposal = null;
  let revision = 0;
  let fingerprint = '';

  const buttons = MESSAGE_LANGUAGES.map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'language-flag';
    button.title = option.label;
    button.setAttribute('aria-label', option.label);
    button.setAttribute('aria-controls', 'player-message');
    const flag = document.createElement('span');
    flag.textContent = option.flag;
    flag.setAttribute('aria-hidden', 'true');
    button.append(flag);
    button.addEventListener('click', () => {
      language = option.id;
      render(proposal);
      try { saveMessageLanguage(window.localStorage, language); }
      catch { status.textContent = 'Language changed for this visit. Your browser could not save the preference.'; }
    });
    picker.append(button);
    return button;
  });

  function render(nextProposal) {
    proposal = nextProposal;
    const nextFingerprint = JSON.stringify([proposal?.player.id, proposal?.player.name, proposal?.x, proposal?.y, language]);
    if (fingerprint !== nextFingerprint) {
      fingerprint = nextFingerprint;
      revision++;
      copy.disabled = !proposal;
      copy.textContent = 'Copy message';
      status.textContent = '';
    }
    panel.hidden = !proposal;
    message.value = formatPlacementMessage(proposal, language);
    message.lang = language;
    document.getElementById('message-recipient').textContent = proposal ? `For ${proposal.player.name}` : '';
    const selected = MESSAGE_LANGUAGES.find(option => option.id === language);
    document.getElementById('message-language-name').textContent = selected.name;
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(MESSAGE_LANGUAGES[index].id === language)));
  }

  copy.addEventListener('click', async () => {
    if (!proposal || copy.disabled) return;
    const currentRevision = revision;
    const text = message.value;
    const copiedProposal = proposal;
    const copiedLanguage = language;
    copy.disabled = true;
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(text);
      onCopy(copiedProposal, copiedLanguage);
      // A language change or placement action may happen while permission is pending.
      if (currentRevision !== revision) return;
      copy.textContent = 'Copied!';
      status.textContent = 'Ready to paste into your chat with this player.';
    } catch {
      if (currentRevision !== revision) return;
      message.focus();
      message.select();
      status.textContent = 'Copy is unavailable here. The message is selected: use your device’s Copy command, then paste it into chat.';
    } finally {
      if (currentRevision === revision) copy.disabled = false;
    }
  });

  // Also track a full manual copy when clipboard permission is unavailable.
  message.addEventListener('copy', () => {
    if (proposal && message.selectionStart === 0 && message.selectionEnd === message.value.length) {
      const copiedProposal = proposal;
      const copiedLanguage = language;
      // Let the browser copy the selection before rendering can change it.
      setTimeout(() => onCopy(copiedProposal, copiedLanguage), 0);
    }
  });

  return { render };
}

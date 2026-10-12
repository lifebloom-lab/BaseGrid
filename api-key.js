// Deliberately separate from rosters, plans, preferences, and portable backups.
export const API_KEY_STORAGE_KEY = 'basegrid.lastwar-api-key.v1';

function cleanKey(value) {
  return typeof value === 'string' && value.trim() && value.length <= 1024 && !/[\r\n]/.test(value) ? value.trim() : '';
}

export function readSavedApiKey(storage) {
  return cleanKey(storage.getItem(API_KEY_STORAGE_KEY));
}

export function saveApiKey(storage, value) {
  const key = cleanKey(value);
  if (!key) throw new Error('Enter a valid API key.');
  storage.setItem(API_KEY_STORAGE_KEY, key);
}

export function forgetApiKey(storage) {
  storage.removeItem(API_KEY_STORAGE_KEY);
}

/** Shared opt-in controls for import and refresh. Save only after a successful lookup. */
export function setupSavedApiKey(input, { onWarning = () => {} } = {}) {
  const controls = document.createElement('div');
  controls.className = 'api-key-options';
  const label = document.createElement('label');
  label.className = 'api-key-remember';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  label.append(checkbox, document.createTextNode('Remember key on this device'));
  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'text-button api-key-forget';
  forget.textContent = 'Forget saved key';
  forget.hidden = true;
  const help = document.createElement('p');
  help.className = 'field-help';
  help.id = input.id + '-remember-help';
  checkbox.setAttribute('aria-describedby', help.id);
  controls.append(label, forget, help);
  const description = document.getElementById(input.getAttribute('aria-describedby'));
  (description ?? input).insertAdjacentElement('afterend', controls);
  let saved = '';
  const storage = () => window.localStorage;

  function render() {
    forget.hidden = !saved;
    help.textContent = saved ? 'Saved in this browser. Use only on a device you trust.'
      : checkbox.checked ? 'Saved after a successful lookup. Use only on a device you trust.'
      : 'Optional. Your key stays in this browser and is excluded from exports.';
  }

  function remove() {
    try {
      forgetApiKey(storage());
      saved = '';
      checkbox.checked = false;
      render();
      return true;
    } catch {
      checkbox.checked = Boolean(saved);
      onWarning('The saved key could not be removed. Check browser storage and try again.');
      return false;
    }
  }
  checkbox.addEventListener('change', () => {
    if (!checkbox.checked) remove();
    render();
  });
  forget.addEventListener('click', () => {
    if (!remove()) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });

  return {
    open() {
      saved = '';
      try { saved = readSavedApiKey(storage()); }
      catch { onWarning('Saved keys are unavailable. You can still enter a key for this lookup.'); }
      input.value = saved;
      checkbox.checked = Boolean(saved);
      render();
    },
    remember(value) {
      if (!checkbox.checked || input.value.trim() !== value.trim()) return;
      try {
        saveApiKey(storage(), value);
        saved = value.trim();
        render();
      } catch {
        onWarning('Your lookup worked, but the key could not be saved. Keep it handy for next time.');
      }
    },
    setBusy(busy) { checkbox.disabled = busy; forget.disabled = busy; },
    clear() { input.value = ''; saved = ''; checkbox.checked = false; },
  };
}

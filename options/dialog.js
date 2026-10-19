import { t } from './i18n.js';
// Styled HTML dialog keeps focus inside the modal and makes the page inert.
export function showOptionsConfirmation({ title, message, warning = '', acceptLabel = t('import_dialog_accept'), danger = false, exportFormat = false }) {
  const dialog = document.getElementById('import-confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  const cancel = document.getElementById('import-confirm-cancel');
  const accept = document.getElementById('import-confirm-accept');
  accept.textContent = acceptLabel;
  accept.classList.toggle('danger', danger);
  const previousFocus = document.activeElement;
  document.getElementById('import-confirm-title').textContent = title;
  document.getElementById('import-confirm-message').textContent = message;
  document.getElementById('import-confirm-warning').textContent = warning;
  document.getElementById('import-confirm-warning-box').hidden = !warning;
  const formatBox = document.getElementById('export-format-box');
  const formatSelect = document.getElementById('export-format-select');
  formatBox.hidden = !exportFormat;
  if (exportFormat) formatSelect.value = 'binary';

  return new Promise(resolve => {
    let settled = false;
    const finish = accepted => {
      if (settled) return;
      settled = true;
      cancel.removeEventListener('click', onCancelClick);
      accept.removeEventListener('click', onAccept);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onBackdrop);
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(accepted && exportFormat ? formatSelect.value : accepted);
    };
    const onCancelClick = () => finish(false);
    const onAccept = () => finish(true);
    const onCancel = event => { event.preventDefault(); finish(false); };
    const onClose = () => { if (!dialog.open) finish(false); };
    const onBackdrop = event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) finish(false);
    };
    cancel.addEventListener('click', onCancelClick);
    accept.addEventListener('click', onAccept);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('click', onBackdrop);
    dialog.showModal();
    cancel.focus();
  });
}

export function showImportConfirmation(options) {
  return showOptionsConfirmation(options);
}

export function showExportFormat() {
  return showOptionsConfirmation({
    title: t('export_dialog_title'), message: t('export_dialog_description'),
    acceptLabel: t('export_dialog_accept'), exportFormat: true
  });
}

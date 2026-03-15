export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/**
 * Shows a modal confirmation dialog. Returns a promise that resolves to true if
 * the user confirms, false if they cancel or close the dialog.
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
  } = options;

  const existing = document.querySelector('.modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const confirmBtnClass = danger ? 'btn btn-danger' : 'btn';

  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-header">
      <h2>${escapeHtml(title)}</h2>
      <button class="modal-close" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">
      <p style="margin: 0; font-size: 0.9rem;">${escapeHtml(message)}</p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" data-role="cancel">Cancel</button>
      <button type="button" class="${confirmBtnClass}" data-role="confirm">${escapeHtml(confirmLabel)}</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        close(false);
      }
    });

    modal.querySelector<HTMLButtonElement>('.modal-close')?.addEventListener('click', () => close(false));
    modal.querySelector<HTMLButtonElement>('[data-role="cancel"]')?.addEventListener('click', () => close(false));
    modal.querySelector<HTMLButtonElement>('[data-role="confirm"]')?.addEventListener('click', () => close(true));
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

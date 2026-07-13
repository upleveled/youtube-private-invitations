/* eslint-disable no-restricted-syntax -- Content script automation reads and edits YouTube Studio DOM */

import { defineContentScript } from 'wxt/utils/define-content-script';

const buttonId = 'youtube-private-invitations-share-private';
const statusId = 'youtube-private-invitations-status';
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const rowSelector =
  'ytcp-video-row, ytcp-video-list-row, ytcp-video-list-cell-video, tr';
const clickableSelector =
  'button, tp-yt-paper-button, ytcp-button, ytcp-dropdown-trigger, [role="button"]';

export default defineContentScript({
  matches: ['https://studio.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    addStyles();
    addShareButton();

    new MutationObserver(addShareButton).observe(document.body, {
      childList: true,
      subtree: true,
    });
  },
});

function addStyles() {
  document.documentElement.insertAdjacentHTML(
    'beforeend',
    `<style>
      #${buttonId} { background: #0f0f0f; border: 0; border-radius: 2px; color: #fff; cursor: pointer; font: 500 13px/20px Roboto, Arial, sans-serif; height: 32px; margin-left: 8px; padding: 0 12px; }
      #${buttonId}:disabled { cursor: wait; opacity: 0.6; }
      #${statusId} { background: #0f0f0f; border-radius: 2px; bottom: 24px; color: #fff; font: 400 13px/20px Roboto, Arial, sans-serif; left: 24px; max-width: 420px; padding: 12px 16px; position: fixed; z-index: 2147483647; }
      .youtube-private-invitations-dialog { background: rgba(15, 15, 15, 0.48); inset: 0; position: fixed; z-index: 2147483647; }
      .youtube-private-invitations-dialog form { background: #fff; border-radius: 4px; box-shadow: 0 12px 32px rgba(15, 15, 15, 0.28); box-sizing: border-box; color: #0f0f0f; font: 400 14px/20px Roboto, Arial, sans-serif; left: 50%; max-width: calc(100vw - 48px); padding: 20px; position: fixed; top: 50%; transform: translate(-50%, -50%); width: 420px; }
      .youtube-private-invitations-dialog h2 { font: 500 18px/24px Roboto, Arial, sans-serif; margin: 0 0 12px; }
      .youtube-private-invitations-dialog textarea { border: 1px solid #d0d0d0; border-radius: 2px; box-sizing: border-box; font: 400 14px/20px Roboto, Arial, sans-serif; min-height: 128px; padding: 8px; resize: vertical; width: 100%; }
      .youtube-private-invitations-dialog menu { display: flex; gap: 8px; justify-content: flex-end; margin: 16px 0 0; padding: 0; }
      .youtube-private-invitations-dialog button { border: 0; border-radius: 2px; cursor: pointer; font: 500 13px/20px Roboto, Arial, sans-serif; padding: 8px 12px; }
      .youtube-private-invitations-dialog button[type='button'] { background: transparent; color: #606060; }
      .youtube-private-invitations-dialog button[type='submit'] { background: #0f0f0f; color: #fff; }
    </style>`,
  );
}

function addShareButton() {
  if (document.getElementById(buttonId)) {
    return;
  }

  const toolbar = document.querySelector('ytcp-bulk-actions .toolbar');

  if (!toolbar) {
    return;
  }

  toolbar.insertAdjacentHTML(
    'beforeend',
    `<button id="${buttonId}" type="button">Share privately</button>`,
  );

  requireElement(document.getElementById(buttonId), 'Share privately button')
    .addEventListener('click', () => {
      void sharePrivately().catch((error: unknown) => {
        showStatus(error instanceof Error ? error.message : String(error));
      });
  });
}

async function sharePrivately() {
  const button = document.getElementById(buttonId) as HTMLButtonElement;

  try {
    button.disabled = true;
    showStatus('Collecting selected videos');

    const videoIds = [
      ...new Set(
        Array.from(document.querySelectorAll(rowSelector))
          .filter((row) => {
            return (
              row.querySelector('[checked], [aria-checked="true"]') !== null ||
              row.matches('[selected], [aria-selected="true"]')
            );
          })
          .map((row) => {
            const videoId = row.getAttribute('video-id');

            if (videoId) {
              return videoId;
            }

            const link = row.querySelector<HTMLAnchorElement>('a[href*="/video/"]');

            if (!link) {
              throw new Error('Selected video row has no Studio video link');
            }

            const match = link.href.match(/\/video\/(?<videoId>[^/?#]+)/u);

            if (!match || !match.groups || !match.groups.videoId) {
              throw new Error(`Could not read video ID from ${link.href}`);
            }

            return match.groups.videoId;
          }),
      ),
    ];

    if (videoIds.length === 0) {
      throw new Error('Select one or more videos in YouTube Studio first');
    }

    const firstVideoId = videoIds[0];

    if (!firstVideoId) {
      throw new Error('Select one or more videos in YouTube Studio first');
    }

    const nativeInvitees = await collectNativeInvitees(firstVideoId);
    const invitees =
      nativeInvitees === null ? await askForInvitees() : nativeInvitees;

    if (invitees.length === 0) {
      throw new Error('Add at least one invitee email address');
    }

    for (const [index, videoId] of videoIds
      .slice(nativeInvitees === null ? 0 : 1)
      .entries()) {
      showStatus(`Sharing ${index + 1} of ${videoIds.length}: ${videoId}`);
      await applyInvitees(videoId, invitees);

      if (index < videoIds.length - 1) {
        await wait(1000 + Math.floor(Math.random() * 2000));
      }
    }

    showStatus(`Shared ${invitees.length} invitees with ${videoIds.length} videos`);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
  }
}

async function collectNativeInvitees(videoId: string) {
  if (!(await openPrivateShareDialog(videoId))) {
    return null;
  }

  const dialog = await waitForPrivateShareDialog();

  return await new Promise<string[] | null>((resolve) => {
    const timeout = window.setTimeout(() => {
      dialog.removeEventListener('click', readInvitees, true);
      resolve(null);
    }, 30000);

    function readInvitees(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('#done-button, button[aria-label="Done"]')
      ) {
        window.clearTimeout(timeout);
        dialog.removeEventListener('click', readInvitees, true);
        resolve(parseEmails(dialog.textContent));
      }
    }

    dialog.addEventListener('click', readInvitees, true);
  });
}

async function applyInvitees(videoId: string, invitees: string[]) {
  if (!(await openPrivateShareDialog(videoId))) {
    throw new Error(`Could not open private-share dialog for ${videoId}`);
  }

  const dialog = await waitForPrivateShareDialog();
  const input = await waitFor(
    () =>
      dialog.querySelector<HTMLInputElement>(
        '#text-input[aria-label="Invitees"]',
      ),
    3000,
  );

  if (!input) {
    throw new Error('Could not find the private-share email input');
  }

  for (const invitee of invitees) {
    const inputValueDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value',
    );

    if (!inputValueDescriptor || !inputValueDescriptor.set) {
      throw new Error('Could not set the private-share email input value');
    }

    inputValueDescriptor.set.call(input, invitee);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    await wait(150);
  }

  const notifyCheckbox = dialog.querySelector<HTMLElement>(
    '#notify-via-email-checkbox #checkbox[aria-label="Notify via email"]',
  );

  if (!notifyCheckbox) {
    throw new Error('Could not find the Notify via email checkbox');
  }

  if (notifyCheckbox.getAttribute('aria-checked') === 'true') {
    notifyCheckbox.click();
  }

  let doneButton = dialog.querySelector<HTMLElement>(
    '#done-button button[aria-label="Done"]',
  );

  if (!doneButton) {
    doneButton = dialog.querySelector<HTMLElement>('#done-button');
  }

  if (!doneButton) {
    throw new Error('Could not find the private-share Done button');
  }

  doneButton.click();
}

async function openPrivateShareDialog(videoId: string) {
  const link = document.querySelector(`a[href*="/video/${CSS.escape(videoId)}"]`);

  if (!link) {
    return false;
  }

  const row = link.closest(rowSelector);

  if (!row) {
    return false;
  }

  const shareButton = Array.from(row.querySelectorAll<HTMLElement>(clickableSelector)).find(
    (element) => {
      return ['Share privately', 'Share video privately'].includes(
        element.textContent.trim(),
      );
    },
  );

  if (shareButton) {
    shareButton.click();
    return true;
  }

  let visibilityControl = row.querySelector<HTMLElement>(
    'ytcp-video-visibility-select',
  );

  if (!visibilityControl) {
    visibilityControl = row.querySelector<HTMLElement>('[aria-label*="Visibility"]');
  }

  if (!visibilityControl) {
    visibilityControl = row.querySelector<HTMLElement>('[test-id*="VISIBILITY"]');
  }

  if (!visibilityControl) {
    visibilityControl = row.querySelector<HTMLElement>('[id*="visibility" i]');
  }

  if (!visibilityControl) {
    return false;
  }

  visibilityControl.click();

  const menuShareButton = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>(clickableSelector)).find(
        (element) => {
          return ['Share privately', 'Share video privately'].includes(
            element.textContent.trim(),
          );
        },
      ) || null,
    3000,
  );

  if (!menuShareButton) {
    return false;
  }

  menuShareButton.click();
  return true;
}

async function waitForPrivateShareDialog() {
  const dialog = await waitFor(
    () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          'ytcp-dialog.ytcp-private-video-sharing-dialog, ytcp-dialog',
        ),
      ).find((element) => {
        return element.textContent.includes('Share video privately');
      }) || null,
    5000,
  );

  if (!dialog) {
    throw new Error('Could not find the YouTube private-share dialog');
  }

  return dialog;
}

async function askForInvitees() {
  return await new Promise<string[]>((resolve) => {
    document.documentElement.insertAdjacentHTML(
      'beforeend',
      `<div class="youtube-private-invitations-dialog">
        <form>
          <h2>Share privately</h2>
          <textarea autofocus placeholder="person@example.com&#10;team@example.com"></textarea>
          <menu>
            <button type="button">Cancel</button>
            <button type="submit">Apply</button>
          </menu>
        </form>
      </div>`,
    );

    const dialog = requireElement(
      document.querySelector<HTMLElement>(
        '.youtube-private-invitations-dialog',
      ),
      'Invitee entry dialog',
    );
    const textarea = requireElement(
      dialog.querySelector('textarea'),
      'Invitee entry textarea',
    );

    requireElement(dialog.querySelector('form'), 'Invitee entry form')
      .addEventListener('submit', (event) => {
        event.preventDefault();
        dialog.remove();
        resolve(parseEmails(textarea.value));
      });
    requireElement(
      dialog.querySelector('button[type="button"]'),
      'Invitee entry cancel button',
    ).addEventListener('click', () => {
        dialog.remove();
        resolve([]);
      });
    textarea.focus();
  });
}

async function waitFor<ElementType extends Element>(
  findElement: () => ElementType | null,
  timeoutMs: number,
) {
  return await new Promise<ElementType | null>((resolve) => {
    let timeout = 0;
    const observer = new MutationObserver(() => {
      const element = findElement();

      if (element) {
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(element);
      }
    });

    const element = findElement();

    if (element) {
      resolve(element);
      return;
    }

    timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

function parseEmails(text: string) {
  const emails = text.match(emailPattern);

  if (!emails) {
    return [];
  }

  return [...new Set(emails)];
}

function showStatus(message: string) {
  const existingStatus = document.getElementById(statusId);

  if (existingStatus) {
    existingStatus.remove();
  }

  document.documentElement.insertAdjacentHTML(
    'beforeend',
    `<div id="${statusId}"></div>`,
  );
  requireElement(document.getElementById(statusId), 'Status message').textContent =
    message;

  window.setTimeout(() => {
    const status = document.getElementById(statusId);

    if (status && status.textContent === message) {
      status.remove();
    }
  }, 6000);
}

function requireElement<ElementType extends Element>(
  element: ElementType | null,
  description: string,
) {
  if (!element) {
    throw new Error(`Could not find ${description}`);
  }

  return element;
}

async function wait(milliseconds: number) {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

document.getElementById('captureBtn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.textContent = 'Capturing...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const sendMessage = () => {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    };

    try {
        let response;
        try {
            response = await sendMessage();
        } catch (err) {
            if (err.message.includes('Could not establish connection')) {
                // Content script might not be loaded. Inject it.
                status.textContent = 'Injecting script...';
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                // Wait a tiny bit for it to initialize
                await new Promise(r => setTimeout(r, 100));
                response = await sendMessage();
            } else {
                throw err;
            }
        }

        if (response && response.data) {
            const json = JSON.stringify(response.data);
            const sizeKB = Math.round(json.length / 1024);
            navigator.clipboard.writeText(json).then(() => {
                status.textContent = `Copied ${sizeKB}KB to clipboard!`;
            }).catch(err => {
                status.textContent = 'Failed to copy: ' + err;
            });
        } else {
            status.textContent = 'No data captured or page too complex.';
        }
    } catch (err) {
        status.textContent = 'Error: ' + err.message;
    }
});

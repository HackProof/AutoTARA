const local = async (data, fileName) => {
    const fullFileName = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
    return await downloadFile(data, fullFileName);
};

const text = async (content, fileName, contentType = 'text/plain') => {
    return await downloadContent(content, fileName, contentType);
};

async function downloadFile(data, fileName) {
    const jsonData = JSON.stringify(data, null, 2);
    return await downloadContent(jsonData, fileName, 'application/json');
}

async function downloadContent(content, fileName, contentType) {
    const blob = new Blob([content], { type: contentType });
    const isYaml = fileName.endsWith('.yml') || fileName.endsWith('.yaml');
    const isModel = /_Model\.json$/i.test(fileName);

    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: isYaml || isModel ? 'MAL Model File' : 'TARA Threat Model File',
                    accept: isYaml
                        ? { 'application/x-yaml': ['.yml', '.yaml'] }
                        : { 'application/json': ['.json'] },
                }],
            });

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            console.debug('Saved using File System Access API');
            return true;
        } catch (err) {
            if (err.name === 'AbortError') {
                console.debug('User cancelled the save dialog');
                return false;
            }

            console.warn('File System Access API failed, falling back to legacy download:', err);
        }
    }

    try {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        console.debug('Save using browser legacy download (anchor tag)');

        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);

        a.click();

        setTimeout(() => {
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        }, 100);

        return true;
    } catch (e) {
        console.error('Download failed', e);
        return false;
    }
}

export default {
    local,
    text,
};

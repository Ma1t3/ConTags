const MAX_SUGGESTIONS = 8;

export function createContactLabelEditor({
    editor,
    chips,
    input,
    suggestions,
    getAvailableLabels
}) {
    if (!editor || !chips || !input || !suggestions) {
        return createLegacyLabelEditor(document.querySelector('input[name="labels"]'));
    }

    let labels = [];
    let visibleSuggestions = [];
    let activeSuggestionIndex = -1;

    editor.addEventListener('click', event => {
        if (!event.target.closest('.contact-label-remove')) input.focus();
    });
    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('blur', () => {
        window.setTimeout(() => {
            if (!suggestions.contains(document.activeElement)) {
                commitInput();
                closeSuggestions();
            }
        }, 0);
    });

    function handleInput() {
        const parts = input.value.split(',');
        if (parts.length > 1) {
            const unfinished = parts.pop();
            parts.forEach(addLabel);
            input.value = unfinished;
        }
        renderSuggestions();
    }

    function handleKeydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (suggestions.hidden) renderSuggestions();
            if (!visibleSuggestions.length) return;
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            activeSuggestionIndex = (
                activeSuggestionIndex + direction + visibleSuggestions.length
            ) % visibleSuggestions.length;
            updateActiveSuggestion();
            return;
        }

        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            if (activeSuggestionIndex >= 0 && visibleSuggestions[activeSuggestionIndex]) {
                addLabel(visibleSuggestions[activeSuggestionIndex]);
            } else {
                commitInput();
            }
            return;
        }

        if (event.key === 'Backspace' && !input.value && labels.length) {
            labels.pop();
            renderChips();
            renderSuggestions();
            return;
        }

        if (event.key === 'Escape') closeSuggestions();
    }

    function setLabels(values) {
        labels = [];
        (values || []).forEach(value => {
            const label = typeof value === 'string' ? value.trim() : '';
            if (label && !hasLabel(label)) labels.push(label);
        });
        input.value = '';
        renderChips();
        closeSuggestions();
    }

    function getLabels() {
        return [...labels];
    }

    function commitInput() {
        return addLabel(input.value);
    }

    function addLabel(rawLabel) {
        const candidate = String(rawLabel || '').trim();
        if (!candidate) {
            input.value = '';
            return false;
        }

        const existingLabel = Array.from(getAvailableLabels()).find(label =>
            typeof label === 'string' && labelsMatch(label, candidate)
        );
        const label = existingLabel || candidate;
        input.value = '';
        if (hasLabel(label)) {
            renderSuggestions();
            return false;
        }

        labels.push(label);
        renderChips();
        renderSuggestions();
        return true;
    }

    function removeLabel(label) {
        labels = labels.filter(item => !labelsMatch(item, label));
        renderChips();
        renderSuggestions();
        input.focus();
    }

    function hasLabel(label) {
        return labels.some(item => labelsMatch(item, label));
    }

    function labelsMatch(first, second) {
        return first.localeCompare(second, undefined, { sensitivity: 'accent' }) === 0;
    }

    function renderChips() {
        chips.innerHTML = '';
        labels.forEach(label => {
            const chip = document.createElement('span');
            chip.className = 'contact-label-chip';

            const text = document.createElement('span');
            text.textContent = label;
            text.title = label;

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'contact-label-remove';
            removeButton.setAttribute('aria-label', `Remove ${label} label`);
            removeButton.textContent = '\u00d7';
            removeButton.addEventListener('click', () => removeLabel(label));

            chip.append(text, removeButton);
            chips.appendChild(chip);
        });
    }

    function renderSuggestions() {
        const query = input.value.trim().toLocaleLowerCase();
        const seen = new Set();
        visibleSuggestions = Array.from(getAvailableLabels())
            .filter(label => {
                if (typeof label !== 'string' || hasLabel(label)) return false;
                const key = label.toLocaleLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return !query || key.includes(query);
            })
            .sort((first, second) => first.localeCompare(second))
            .slice(0, MAX_SUGGESTIONS);
        activeSuggestionIndex = -1;
        suggestions.innerHTML = '';

        visibleSuggestions.forEach((label, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.id = `contactLabelSuggestion-${index}`;
            option.className = 'contact-label-suggestion';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.textContent = label;
            option.addEventListener('pointerdown', event => event.preventDefault());
            option.addEventListener('click', () => {
                addLabel(label);
                input.focus();
            });
            suggestions.appendChild(option);
        });

        suggestions.hidden = visibleSuggestions.length === 0;
        input.setAttribute('aria-expanded', String(!suggestions.hidden));
        input.removeAttribute('aria-activedescendant');
    }

    function updateActiveSuggestion() {
        Array.from(suggestions.children).forEach((option, index) => {
            const active = index === activeSuggestionIndex;
            option.classList.toggle('is-active', active);
            option.setAttribute('aria-selected', String(active));
            if (active) {
                input.setAttribute('aria-activedescendant', option.id);
                option.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function closeSuggestions() {
        visibleSuggestions = [];
        activeSuggestionIndex = -1;
        suggestions.hidden = true;
        suggestions.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    return { setLabels, getLabels, commitInput };
}

function createLegacyLabelEditor(input) {
    function setLabels(labels) {
        if (input) input.value = (labels || []).join(', ');
    }

    function getLabels() {
        const seen = new Set();
        return (input ? input.value : '')
            .split(',')
            .map(label => label.trim())
            .filter(label => {
                const key = label.toLocaleLowerCase();
                if (!label || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    return { setLabels, getLabels, commitInput: () => false };
}

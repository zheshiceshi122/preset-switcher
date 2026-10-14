const DICE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.7"/><g fill="currentColor"><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="16" r="1.2"/></g></svg>';
const PRESET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/><g fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></g></svg>';
const SETTINGS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3.5h5l.7 2.1 2 .9 2.1-.4 2.5 4.3-1.4 1.7v2.2l1.4 1.7-2.5 4.3-2.1-.4-2 .9-.7 2.1h-5l-.7-2.1-2-.9-2.1.4-2.5-4.3 1.4-1.7v-2.2L2.2 10.4l2.5-4.3 2.1.4 2-.9z" transform="translate(0 -1) scale(1 .95)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

export function drawCandidates(characters, settings, currentAvatar) {
    const seen = new Set();
    return (characters ?? []).filter(character => {
        if (!character?.avatar || character.avatar === 'none' || seen.has(character.avatar)) return false;
        seen.add(character.avatar);
        if (settings.drawScope === 'favorites' && character.fav !== true && character.fav !== 'true') return false;
        return !settings.drawExcludeCurrent || character.avatar !== currentAvatar;
    });
}

export function createCharacterDraw({ host, getSettings, saveSettings, createDialog, makeButton, openPresets, canOpenPresets, getPresetPool, canApplyPreset, applyPreset }) {
    let active = null;
    let settingsDialog = null;
    let animation = null;
    const drawn = { characters: new Set(), presets: new Set() };

    function closeSettings() {
        settingsDialog?.backdrop.remove();
        settingsDialog = null;
    }

    function close() {
        closeSettings();
        active?.backdrop.remove();
        active = null;
        animation?.cancel();
        animation = null;
    }

    function dismissible(dialog, action) {
        dialog.backdrop.addEventListener('click', event => {
            if (event.target !== dialog.backdrop) return;
            event.stopImmediatePropagation();
            action();
        }, true);
        dialog.backdrop.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            action();
        });
    }

    function characterCandidates() {
        const current = host.characters?.[host.this_chid]?.avatar;
        return drawCandidates(host.characters, getSettings(), current).map(character => ({
            key: character.avatar,
            kind: 'character',
            name: character.name || '未命名角色',
            avatar: character.avatar,
            source: character,
        }));
    }

    function presetPool() {
        const pool = getPresetPool?.() ?? { scope: 'global', entries: [] };
        const scope = pool.scope === 'character' ? 'character' : 'global';
        const entries = Array.isArray(pool.entries) ? pool.entries : [];
        return {
            scope,
            entries: entries.map(entry => ({
                key: `${scope}:${entry.name}`,
                kind: 'preset',
                name: scope === 'character' ? (entry.sourceName || entry.name) : entry.name,
                scope,
                source: entry,
            })),
        };
    }

    function presetCandidates() {
        return presetPool().entries;
    }

    function candidates(mode) {
        return mode === 'presets' ? presetCandidates() : characterCandidates();
    }

    function openChoice() {
        close();
        const dialog = createDialog('今天想做什么？', '管理角色预设，或开始一场随机选择。');
        active = dialog;
        dialog.backdrop.querySelector('.ps-dialog').classList.add('ps-entry-choice-dialog');
        dismissible(dialog, close);
        const choices = document.createElement('div');
        choices.className = 'ps-entry-choices';
        const tile = (icon, title, hint, action) => {
            const button = makeButton('', action, 'ps-entry-choice');
            const graphic = document.createElement('span');
            graphic.className = 'ps-entry-choice-icon';
            graphic.innerHTML = icon;
            const name = document.createElement('strong');
            name.textContent = title;
            const description = document.createElement('span');
            description.textContent = hint;
            button.append(graphic, name, description);
            choices.append(button);
            return button;
        };
        const available = canOpenPresets();
        const preset = tile(PRESET_SVG, '预设切换器', available ? '切换、编辑当前角色绑定的预设' : '先进入角色聊天并使用聊天补全 API', () => { close(); openPresets(); });
        preset.disabled = !available;
        const draw = tile(DICE_SVG, '角色 / 预设抽卡', '一次抽出 1–5 个结果，再选一个开始', open);
        dialog.body.append(choices);
        dialog.footer.append(makeButton('关闭', close));
        draw.focus();
    }

    function openDrawSettings(onSaved) {
        closeSettings();
        const dialog = createDialog('抽卡设置', '设置每次抽取数量、角色范围和预设范围。');
        dialog.backdrop.querySelector('.ps-dialog').classList.add('ps-draw-settings-dialog');
        settingsDialog = dialog;
        dismissible(dialog, closeSettings);
        const settings = getSettings();
        const field = (title, control) => {
            const label = document.createElement('label');
            label.className = 'ps-settings-field';
            const caption = document.createElement('span');
            caption.textContent = title;
            label.append(caption, control);
            dialog.body.append(label);
            return control;
        };
        const count = document.createElement('select');
        count.className = 'text_pole';
        for (let value = 1; value <= 5; value++) {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = `${value} 抽`;
            count.append(option);
        }
        count.value = String(settings.drawCount);
        field('每次抽取数量', count);
        const range = document.createElement('select');
        range.className = 'text_pole';
        for (const [value, title] of [['all', '全部角色'], ['favorites', '仅收藏角色']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = title;
            range.append(option);
        }
        range.value = settings.drawScope;
        field('角色抽卡范围', range);
        const checkbox = (caption, checked) => {
            const label = document.createElement('label');
            label.className = 'ps-settings-checkbox';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = checked;
            label.append(input, document.createTextNode(caption));
            dialog.body.append(label);
            return input;
        };
        const exclude = checkbox('排除当前正在玩的角色', settings.drawExcludeCurrent);
        const currentCharacterPresetsOnly = checkbox('预设抽卡仅使用当前角色绑定的预设', settings.drawCurrentCharacterPresetsOnly);
        const repeat = checkbox('同一轮不重复抽取', settings.drawNoRepeat);
        const hint = document.createElement('p');
        hint.className = 'ps-editor-hint';
        hint.textContent = '开启后，角色聊天中只从当前角色绑定的预设抽取；关闭后始终从酒馆全局预设库抽取。未进入角色聊天时始终使用全局预设。数量超过候选数时，同一轮可能重复。';
        dialog.body.append(hint);
        dialog.footer.append(makeButton('取消', closeSettings), makeButton('保存设置', () => {
            saveSettings({ drawCount: Number(count.value), drawScope: range.value, drawCurrentCharacterPresetsOnly: currentCharacterPresetsOnly.checked, drawExcludeCurrent: exclude.checked, drawNoRepeat: repeat.checked });
            drawn.characters.clear();
            drawn.presets.clear();
            closeSettings();
            onSaved();
        }, 'ps-primary'));
        count.focus();
    }

    function open() {
        close();
        const dialog = createDialog('角色 / 预设抽卡', '随机抽取一组结果，选中一个后再开玩或切换。');
        active = dialog;
        dialog.backdrop.querySelector('.ps-dialog').classList.add('ps-draw-dialog');
        dismissible(dialog, close);
        let mode = 'characters';
        let results = [];
        let selectedIndex = -1;
        let busy = false;
        let opening = false;

        const modeSelector = document.createElement('div');
        modeSelector.className = 'ps-draw-mode';
        const modeButtons = {};
        for (const [value, label] of [['characters', '角色'], ['presets', '预设']]) {
            const button = makeButton(label, () => {
                if (mode === value || busy || opening) return;
                mode = value;
                results = [];
                selectedIndex = -1;
                renderResult();
            }, 'ps-draw-mode-button');
            button.dataset.mode = value;
            button.setAttribute('aria-pressed', 'false');
            modeButtons[value] = button;
            modeSelector.append(button);
        }

        const toolbar = document.createElement('div');
        toolbar.className = 'ps-draw-toolbar';
        const scopeText = document.createElement('span');
        scopeText.className = 'ps-draw-scope';
        const settingsButton = makeButton('', () => openDrawSettings(() => {
            results = [];
            selectedIndex = -1;
            renderResult();
        }), 'ps-draw-settings-button');
        settingsButton.innerHTML = SETTINGS_SVG;
        settingsButton.title = '抽卡设置';
        settingsButton.setAttribute('aria-label', '抽卡设置');
        dialog.backdrop.querySelector('.ps-dialog-titlebar').append(settingsButton);
        toolbar.append(scopeText);

        const placeholder = document.createElement('div');
        placeholder.className = 'ps-draw-empty-state';
        const placeholderIcon = document.createElement('span');
        placeholderIcon.className = 'ps-draw-empty-icon';
        placeholderIcon.innerHTML = DICE_SVG;
        const placeholderCopy = document.createElement('span');
        placeholderCopy.className = 'ps-draw-empty-copy';
        placeholderCopy.innerHTML = '<strong>抽一组结果，挑一个开始</strong><small>角色抽卡可以选择下一张卡；预设抽卡范围可在右上角设置中选择当前角色绑定预设或酒馆全局预设。</small>';
        placeholder.append(placeholderIcon, placeholderCopy);
        const grid = document.createElement('div');
        grid.className = 'ps-draw-result-grid';
        const stage = document.createElement('div');
        stage.className = 'ps-draw-stage';
        stage.append(placeholder, grid);
        const status = document.createElement('p');
        status.className = 'ps-draw-status';
        status.setAttribute('role', 'status');
        dialog.body.append(modeSelector, toolbar, stage, status);

        const drawButton = makeButton('抽一张', draw, 'ps-primary ps-draw-button');
        const actionButton = makeButton('开玩', actOnSelection, 'ps-primary ps-draw-action');
        const back = makeButton('返回功能选择', openChoice, 'ps-draw-back');
        dialog.footer.append(drawButton, actionButton, back);

        function renderResult() {
            const pool = candidates(mode);
            const settings = getSettings();
            const selected = results[selectedIndex] ?? null;
            const selectionStillAvailable = selected && pool.some(item => item.key === selected.key);
            if (selected && !selectionStillAvailable) {
                results = [];
                selectedIndex = -1;
            }
            const currentSelection = results[selectedIndex] ?? null;
            modeButtons.characters.setAttribute('aria-pressed', String(mode === 'characters'));
            modeButtons.presets.setAttribute('aria-pressed', String(mode === 'presets'));
            modeButtons.characters.classList.toggle('ps-selected-mode', mode === 'characters');
            modeButtons.presets.classList.toggle('ps-selected-mode', mode === 'presets');
            modeButtons.presets.disabled = busy || opening;
            modeButtons.characters.disabled = busy || opening;
            const presetSource = presetPool();
            const scope = mode === 'characters'
                ? (settings.drawScope === 'favorites' ? '仅收藏角色' : '全部角色')
                : (presetSource.scope === 'character' ? '当前角色绑定预设' : '全局预设库');
            scopeText.textContent = `${scope} · ${pool.length} 个候选 · 每次 ${settings.drawCount} 抽`;
            placeholder.hidden = results.length > 0;
            grid.hidden = results.length === 0;
            placeholder.classList.toggle('ps-draw-is-busy', busy);
            placeholder.setAttribute('aria-hidden', String(results.length > 0));
            grid.replaceChildren();
            grid.dataset.count = String(results.length);
            for (const [index, item] of results.entries()) {
                const tile = makeButton('', () => {
                    if (busy || opening) return;
                    selectedIndex = index;
                    renderResult();
                }, 'ps-draw-result');
                tile.classList.toggle('ps-result-selected', index === selectedIndex);
                tile.setAttribute('aria-pressed', String(index === selectedIndex));
                let artwork = null;
                if (item.kind === 'character') {
                    artwork = document.createElement('span');
                    artwork.className = 'ps-draw-result-artwork';
                    const img = document.createElement('img');
                    img.className = 'ps-draw-result-image';
                    img.alt = '';
                    img.src = host.getThumbnailUrl?.('avatar', item.avatar) ?? `/thumbnail?type=avatar&file=${encodeURIComponent(item.avatar)}`;
                    img.addEventListener('error', () => img.remove());
                    artwork.append(img);
                }
                const selectedMark = document.createElement('span');
                selectedMark.className = 'ps-draw-result-check';
                selectedMark.setAttribute('aria-hidden', 'true');
                selectedMark.innerHTML = '<svg viewBox="0 0 20 20"><path d="m4.5 10.2 3.4 3.4 7.6-7.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>';
                const labels = document.createElement('span');
                labels.className = 'ps-draw-result-labels';
                const title = document.createElement('strong');
                title.textContent = item.name;
                labels.append(title);
                if (item.subtitle) {
                    const subtitle = document.createElement('small');
                    subtitle.textContent = item.subtitle;
                    labels.append(subtitle);
                }
                if (artwork) {
                    const number = document.createElement('span');
                    number.className = 'ps-draw-result-number';
                    number.textContent = String(index + 1).padStart(2, '0');
                    number.setAttribute('aria-hidden', 'true');
                    artwork.append(number);
                    tile.append(artwork, labels, selectedMark);
                } else {
                    tile.classList.add('ps-draw-preset-result');
                    tile.append(labels, selectedMark);
                }
                grid.append(tile);
            }
            const noCandidates = !pool.length;
            if (busy) status.textContent = '正在抽取…';
            else if (mode === 'presets' && !canApplyPreset?.()) status.textContent = '预设抽取可用，但切换预设需要使用 OpenAI / 聊天补全。';
            else if (currentSelection) status.textContent = mode === 'characters'
                ? `已选中「${currentSelection.name}」，点击“开玩”进入聊天。`
                : `已选中「${currentSelection.name}」，点击“切换预设”${currentSelection.scope === 'character' ? '应用到当前角色' : '应用到酒馆'}。`;
            else if (noCandidates && mode === 'presets' && presetSource.scope === 'character') status.textContent = '当前角色还没有绑定预设。先绑定一个或多个预设后即可抽取。';
            else if (noCandidates && mode === 'presets') status.textContent = '酒馆里还没有可抽取的 OpenAI / 聊天补全预设。';
            else if (noCandidates && settings.drawScope === 'favorites') status.textContent = '没有可抽取的收藏角色。可在右上角切换范围，或先收藏角色。';
            else if (noCandidates) status.textContent = '没有可抽取的角色。请先导入角色卡，或取消排除当前角色。';
            else status.textContent = `点击下方按钮，随机抽取 ${settings.drawCount} 个${mode === 'characters' ? '角色' : '预设'}。`;
            drawButton.textContent = results.length ? `再抽 ${settings.drawCount} 抽` : `抽 ${settings.drawCount} 抽`;
            drawButton.disabled = busy || opening || noCandidates || (mode === 'presets' && !canApplyPreset?.());
            actionButton.textContent = mode === 'characters' ? '开玩' : '切换预设';
            actionButton.hidden = !currentSelection;
            actionButton.disabled = busy || opening || (mode === 'presets' && !canApplyPreset?.());
            settingsButton.disabled = busy || opening;
            back.disabled = opening;
            dialog.footer.classList.toggle('ps-draw-has-result', Boolean(currentSelection));
            dialog.footer.classList.toggle('ps-draw-has-results', results.length > 0);
            dialog.body.setAttribute('aria-busy', String(busy));
        }

        async function draw() {
            if (busy || opening) return;
            const pool = candidates(mode);
            if (!pool.length) { renderResult(); return; }
            const count = getSettings().drawCount;
            const result = [];
            const seenThisBatch = new Set();
            for (let i = 0; i < count; i++) {
                let available = getSettings().drawNoRepeat ? pool.filter(item => !drawn[mode].has(item.key) && !seenThisBatch.has(item.key)) : pool;
                if (!available.length) {
                    drawn[mode].clear();
                    available = pool.filter(item => !seenThisBatch.has(item.key));
                    if (!available.length) available = pool;
                }
                const item = available[Math.floor(Math.random() * available.length)];
                result.push(item);
                seenThisBatch.add(item.key);
            }
            let currentAnimation = null;
            busy = true;
            drawButton.disabled = true;
            actionButton.disabled = true;
            settingsButton.disabled = true;
            renderResult();
            try {
                if (typeof stage.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    currentAnimation = stage.animate([
                        { transform: 'translateY(0) scale(1)', opacity: 1 },
                        { transform: 'translateY(-8px) scale(.98)', opacity: .55, offset: .5 },
                        { transform: 'translateY(0) scale(1)', opacity: 1 },
                    ], { duration: 460, easing: 'ease-in-out' });
                    animation = currentAnimation;
                    await currentAnimation.finished;
                }
            } catch {
                // Keep results usable when animation is cancelled or unavailable.
            } finally {
                if (animation === currentAnimation) animation = null;
                busy = false;
                if (active === dialog) {
                    results = result;
                    selectedIndex = 0;
                    if (getSettings().drawNoRepeat) for (const item of results) drawn[mode].add(item.key);
                    renderResult();
                }
            }
        }

        async function actOnSelection() {
            const selected = results[selectedIndex];
            if (!selected || busy || opening) return;
            if (mode === 'presets') {
                if (!canApplyPreset?.()) { renderResult(); return; }
                opening = true;
                renderResult();
                try {
                    const applied = await applyPreset(selected.source, selected.scope);
                    if (applied && active === dialog) {
                        toastr.success(`已切换到预设「${selected.name}」`);
                        close();
                    }
                    else if (!applied) toastr.info('预设未切换，请确认当前 API 和目标预设仍可用');
                } catch (error) {
                    toastr.error(`切换预设失败：${error.message}`);
                } finally {
                    opening = false;
                    if (active === dialog) renderResult();
                }
                return;
            }
            const id = host.characters?.findIndex(character => character?.avatar === selected.avatar) ?? -1;
            if (id < 0) { results = []; selectedIndex = -1; renderResult(); toastr.warning('这张角色卡已不在角色库里，请重新抽取'); return; }
            if (host.isGenerating?.() || host.isChatSaving) { toastr.info('请等当前聊天生成或保存完成后再开玩'); return; }
            if (typeof host.selectCharacterById !== 'function') { toastr.error('当前酒馆没有提供角色切换接口，请更新酒馆后再试'); return; }
            opening = true;
            renderResult();
            try {
                await host.selectCharacterById(id, { switchMenu: false });
                if (host.characters?.[host.this_chid]?.avatar === selected.avatar) close();
                else toastr.info('酒馆暂时未切换角色，可以稍后再次点击开玩');
            } catch (error) {
                toastr.error(`打开角色失败：${error.message}`);
            } finally {
                opening = false;
                if (active === dialog) renderResult();
            }
        }

        renderResult();
        drawButton.focus();
    }

    return { open, openChoice, close, toggleChoice: () => active ? close() : openChoice() };
}

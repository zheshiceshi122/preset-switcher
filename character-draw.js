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

export function createCharacterDraw({ host, getSettings, saveSettings, createDialog, makeButton, openPresets, canOpenPresets }) {
    let active = null;
    let settingsDialog = null;
    let animation = null;
    const drawn = new Set();

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

    function candidates() {
        const current = host.characters?.[host.this_chid]?.avatar;
        return drawCandidates(host.characters, getSettings(), current);
    }

    function openChoice() {
        close();
        const dialog = createDialog('今天想做什么？', '管理角色预设，或抽一张角色卡开始聊天。');
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
        const preset = tile(PRESET_SVG, '预设切换器', available ? '切换、编辑当前角色的预设' : '先进入角色聊天并使用聊天补全 API', () => { close(); openPresets(); });
        preset.disabled = !available;
        const draw = tile(DICE_SVG, '角色抽卡', '把下一场故事交给随机', open);
        dialog.body.append(choices);
        dialog.footer.append(makeButton('关闭', close));
        draw.focus();
    }

    function openDrawSettings(onSaved) {
        closeSettings();
        const dialog = createDialog('抽卡设置', '只决定抽卡范围，不修改角色卡或预设。');
        dialog.backdrop.querySelector('.ps-dialog').classList.add('ps-draw-settings-dialog');
        settingsDialog = dialog;
        dismissible(dialog, closeSettings);
        const settings = getSettings();
        const rangeLabel = document.createElement('label');
        rangeLabel.className = 'ps-settings-field';
        const caption = document.createElement('span');
        caption.textContent = '抽卡范围';
        const scope = document.createElement('select');
        scope.className = 'text_pole';
        for (const [value, title] of [['all', '全部角色'], ['favorites', '仅收藏角色']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = title;
            scope.append(option);
        }
        scope.value = settings.drawScope;
        rangeLabel.append(caption, scope);
        dialog.body.append(rangeLabel);
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
        const repeat = checkbox('同一轮不重复抽取', settings.drawNoRepeat);
        const hint = document.createElement('p');
        hint.className = 'ps-editor-hint';
        hint.textContent = '收藏使用酒馆角色库里的收藏标记。同轮不重复开启时，抽完候选会自动开始下一轮；只有一张候选时仍可再次抽取。';
        dialog.body.append(hint);
        dialog.footer.append(makeButton('取消', closeSettings), makeButton('保存设置', () => {
            saveSettings({ drawScope: scope.value, drawExcludeCurrent: exclude.checked, drawNoRepeat: repeat.checked });
            drawn.clear();
            closeSettings();
            onSaved();
        }, 'ps-primary'));
        scope.focus();
    }

    function open() {
        close();
        const dialog = createDialog('角色抽卡', '下一场故事，从这里开始。');
        active = dialog;
        dialog.backdrop.querySelector('.ps-dialog').classList.add('ps-draw-dialog');
        dismissible(dialog, close);
        let selected = null;
        let busy = false;
        let opening = false;
        const toolbar = document.createElement('div');
        toolbar.className = 'ps-draw-toolbar';
        const scopeText = document.createElement('span');
        scopeText.className = 'ps-draw-scope';
        const settingsButton = makeButton('', () => openDrawSettings(() => {
            selected = null;
            renderResult();
        }), 'ps-draw-settings-button');
        settingsButton.innerHTML = SETTINGS_SVG;
        settingsButton.title = '抽卡设置';
        settingsButton.setAttribute('aria-label', '抽卡设置');
        dialog.backdrop.querySelector('.ps-dialog-titlebar').append(settingsButton);
        toolbar.append(scopeText);
        const stage = document.createElement('div');
        stage.className = 'ps-draw-stage';
        const card = document.createElement('div');
        card.className = 'ps-draw-card';
        const placeholder = document.createElement('div');
        placeholder.className = 'ps-draw-placeholder';
        placeholder.innerHTML = DICE_SVG;
        const image = document.createElement('img');
        image.className = 'ps-draw-avatar';
        image.alt = '';
        image.hidden = true;
        image.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; });
        card.append(placeholder, image);
        stage.append(card);
        const name = document.createElement('h4');
        name.className = 'ps-draw-name';
        const status = document.createElement('p');
        status.className = 'ps-draw-status';
        status.setAttribute('role', 'status');
        dialog.body.append(toolbar, stage, name, status);
        const drawButton = makeButton('抽一张', draw, 'ps-primary ps-draw-button');
        const playButton = makeButton('开玩', play, 'ps-primary ps-draw-play');
        const back = makeButton('返回功能选择', openChoice, 'ps-draw-back');
        dialog.footer.append(drawButton, playButton, back);

        function renderResult() {
            const pool = candidates();
            const settings = getSettings();
            scopeText.textContent = `${settings.drawScope === 'favorites' ? '仅收藏角色' : '全部角色'} · ${pool.length} 张候选`;
            if (selected && !pool.some(character => character.avatar === selected.avatar)) selected = null;
            name.textContent = selected ? selected.name || '未命名角色' : '今天，和谁开启故事？';
            status.textContent = pool.length ? selected ? '喜欢这张就开玩，也可以再抽一张。' : '点击下方按钮，随机遇见一位角色。' : settings.drawScope === 'favorites' ? '没有可抽取的收藏角色。可在右上角切换范围，或先收藏角色。' : '没有可抽取的角色。请先导入角色卡，或取消排除当前角色。';
            placeholder.hidden = Boolean(selected);
            image.hidden = !selected;
            if (selected) {
                image.alt = selected.name || '角色头像';
                image.src = host.getThumbnailUrl?.('avatar', selected.avatar) ?? `/thumbnail?type=avatar&file=${encodeURIComponent(selected.avatar)}`;
            } else {
                image.removeAttribute('src');
            }
            card.classList.toggle('ps-draw-card-result', Boolean(selected));
            drawButton.textContent = selected ? '再抽一张' : '抽一张';
            drawButton.classList.toggle('ps-primary', !selected);
            drawButton.disabled = busy || opening || !pool.length;
            playButton.hidden = !selected;
            dialog.footer.classList.toggle('ps-draw-has-result', Boolean(selected));
            playButton.disabled = busy || opening;
            settingsButton.disabled = busy || opening;
            back.disabled = opening;
        }

        async function draw() {
            if (busy || opening) return;
            const pool = candidates();
            if (!pool.length) { renderResult(); return; }
            const settings = getSettings();
            let available = settings.drawNoRepeat ? pool.filter(character => !drawn.has(character.avatar)) : pool;
            if (!available.length) {
                drawn.clear();
                available = pool;
                if (selected && pool.length > 1) available = pool.filter(character => character.avatar !== selected.avatar);
            }
            const candidate = available[Math.floor(Math.random() * available.length)];
            let currentAnimation = null;
            busy = true;
            drawButton.disabled = true;
            playButton.disabled = true;
            settingsButton.disabled = true;
            dialog.body.setAttribute('aria-busy', 'true');
            placeholder.hidden = false;
            image.hidden = true;
            name.textContent = '正在寻找下一位…';
            status.textContent = '正在抽取…';
            try {
                if (typeof card.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    currentAnimation = card.animate([
                        { transform: 'rotateY(0deg) translateY(0)', opacity: 1 },
                        { transform: 'rotateY(85deg) translateY(-10px)', opacity: .4, offset: .5 },
                        { transform: 'rotateY(0deg) translateY(0)', opacity: 1 },
                    ], { duration: 460, easing: 'ease-in-out' });
                    animation = currentAnimation;
                    await currentAnimation.finished;
                }
            } catch {
                // The result remains usable when animation is cancelled or unavailable.
            } finally {
                if (animation === currentAnimation) animation = null;
                busy = false;
                dialog.body.removeAttribute('aria-busy');
                if (active === dialog) {
                    selected = candidate;
                    drawn.add(candidate.avatar);
                    renderResult();
                }
            }
        }

        async function play() {
            if (!selected || busy || opening) return;
            const id = host.characters?.findIndex(character => character?.avatar === selected.avatar) ?? -1;
            if (id < 0) { selected = null; renderResult(); toastr.warning('这张角色卡已不在角色库里，请重新抽取'); return; }
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

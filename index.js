import { characters, eventSource, event_types, main_api, saveSettingsDebounced, this_chid } from '../../../../script.js';
import * as tavernHost from '../../../../script.js';
import { selected_group } from '../../../group-chats.js';
import { extension_settings, writeExtensionField } from '../../../extensions.js';
import { getPresetManager } from '../../../preset-manager.js';
import * as chatCompletion from '../../../openai.js';
import { comparableExtensions, readPromptGroups, writePromptGroups } from './baibai-groups.js';
import { createCharacterDraw } from './character-draw.js';

const DATA_KEY = 'preset_switcher';
const UI_SETTINGS_KEY = 'preset_switcher_ui';
const ROOT_ID = 'preset-switcher-root';
const PANEL_ROOT_ID = 'preset-switcher-panel-root';
const VERSION = 1;
const MISSING = Symbol('missing');

let root;
let switcherPanel;
let centeredPanelRoot;
let applyingCharacterId = null;
let applyingEntryName = null;
let applyingPreserveApiSettings = false;
let renderQueued = false;
let presetPage = 1;
let presetPager;
let renderedCharacterId = null;
let launcherVisibilityControl;
let panelFollowControl;
let characterDrawControl;
let characterDraw;
let initialized = false;

const PRESETS_PER_PAGE = 8;
const PROMPTS_PER_PAGE = 15;
const DEFAULT_LAUNCHER_SIZE = 40;

const clone = value => value === MISSING ? MISSING : structuredClone(value);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(a, b) {
    if (a === MISSING || b === MISSING) return a === b;
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
    }
    if (!isObject(a) || !isObject(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return aKeys.length === bKeys.length && aKeys.every((key, i) => key === bKeys[i] && equal(a[key], b[key]));
}

function readCardData(characterId = this_chid) {
    const raw = characters?.[characterId]?.data?.extensions?.[DATA_KEY];
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.presets)) {
        return { version: VERSION, activeName: '', presets: [] };
    }
    return {
        version: VERSION,
        activeName: typeof raw.activeName === 'string' ? raw.activeName : '',
        presets: raw.presets
            .filter(item => item && typeof item.name === 'string' && item.base && item.value)
            .map(item => ({
                ...item,
                sourceName: typeof item.sourceName === 'string' ? item.sourceName : item.name,
                note: typeof item.note === 'string' ? item.note : '',
            })),
    };
}

function getManager() {
    return getPresetManager('openai');
}

function getUiSettings() {
    const settings = extension_settings[UI_SETTINGS_KEY];
    if (!settings || typeof settings !== 'object') {
        extension_settings[UI_SETTINGS_KEY] = { dockSide: 'right', xRatio: 0.98, topRatio: 0.68, launcherImage: '', launcherVisible: true, viewMode: 'full', preserveApiSettings: false };
    }
    const value = extension_settings[UI_SETTINGS_KEY];
    return {
        dockSide: ['left', 'right'].includes(value.dockSide) ? value.dockSide : 'free',
        xRatio: Number.isFinite(value.xRatio) ? Math.min(1, Math.max(0, value.xRatio)) : 0.98,
        topRatio: Number.isFinite(value.topRatio) ? Math.min(1, Math.max(0, value.topRatio)) : 0.68,
        launcherImage: typeof value.launcherImage === 'string' ? value.launcherImage : '',
        launcherVisible: value.launcherVisible !== false,
        panelFollowsLauncher: value.panelFollowsLauncher === true,
        launcherSize: Number.isInteger(value.launcherSize) && value.launcherSize >= 24 && value.launcherSize <= 80 ? value.launcherSize : DEFAULT_LAUNCHER_SIZE,
        characterDrawEnabled: value.characterDrawEnabled === true,
        drawCount: Number.isInteger(value.drawCount) && value.drawCount >= 1 && value.drawCount <= 5 ? value.drawCount : 1,
        drawScope: value.drawScope === 'favorites' ? 'favorites' : 'all',
        drawCurrentCharacterPresetsOnly: value.drawCurrentCharacterPresetsOnly !== false,
        drawExcludeCurrent: value.drawExcludeCurrent !== false,
        drawNoRepeat: value.drawNoRepeat !== false,
        editorCollapsedGroups: isObject(value.editorCollapsedGroups) ? value.editorCollapsedGroups : {},
        customPromptPageSize: value.customPromptPageSize === true,
        promptPageSize: Number.isInteger(value.promptPageSize) && value.promptPageSize >= 1 && value.promptPageSize <= 500 ? value.promptPageSize : PROMPTS_PER_PAGE,
        promptPageAutoTop: value.promptPageAutoTop !== false,
        viewMode: value.viewMode === 'quick' ? 'quick' : 'full',
        preserveApiSettings: value.preserveApiSettings === true,
    };
}

function saveUiSettings(changes) {
    extension_settings[UI_SETTINGS_KEY] = { ...getUiSettings(), ...changes };
    saveSettingsDebounced();
}

function getPromptPageSize(settings = getUiSettings()) {
    return settings.customPromptPageSize ? settings.promptPageSize : PROMPTS_PER_PAGE;
}

function applyLauncherPosition(element, settings = getUiSettings()) {
    const centered = !settings.panelFollowsLauncher;
    const panelParent = centered ? centeredPanelRoot : element;
    if (switcherPanel.parentElement !== panelParent) panelParent.append(switcherPanel);
    centeredPanelRoot.hidden = !centered || element.hidden || switcherPanel.hidden;
    const hitSize = Math.max(48, settings.launcherSize + 16);
    element.style.setProperty('--ps-launcher-size', `${settings.launcherSize}px`);
    element.style.setProperty('--ps-launcher-hit-size', `${hitSize}px`);
    // Use the configured box size, including while the launcher is hidden.
    const width = hitSize;
    const height = hitSize;
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    const top = Math.min(maxTop, Math.max(8, settings.topRatio * maxTop));
    const maxLeft = Math.max(0, window.innerWidth - width);
    const left = settings.dockSide === 'left'
        ? -(width / 2)
        : settings.dockSide === 'right'
            ? window.innerWidth - (width / 2)
            : settings.xRatio * maxLeft;
    element.style.position = 'fixed';
    element.style.top = `${top}px`;
    element.style.bottom = 'auto';
    element.style.left = `${left}px`;
    element.style.right = 'auto';
    element.classList.toggle('ps-left-docked', settings.dockSide === 'left');
    element.classList.toggle('ps-right-docked', settings.dockSide === 'right');
    element.classList.toggle('ps-panel-below', top < window.innerHeight * .42);
    element.classList.toggle('ps-panel-centered', !settings.panelFollowsLauncher);
    keepPanelInViewport(element);
}

function keepPanelInViewport(element) {
    if (element.classList.contains('ps-panel-centered')) {
        element.style.removeProperty('--ps-panel-shift');
        return;
    }
    const panel = switcherPanel;
    if (panel.hidden || element.hidden) return;
    const rect = panel.getBoundingClientRect();
    const previousShift = Number.parseFloat(element.style.getPropertyValue('--ps-panel-shift')) || 0;
    const left = rect.left - previousShift;
    const right = rect.right - previousShift;
    const shift = left < 12 ? 12 - left : right > window.innerWidth - 12 ? window.innerWidth - 12 - right : 0;
    if (shift !== previousShift) element.style.setProperty('--ps-panel-shift', `${shift}px`);
}

function activeCharacterId() {
    return selected_group ? null : this_chid;
}

function findBoundPreset(data, name) {
    return data.presets.find(item => item.name === name);
}

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
        renderQueued = false;
        render();
    });
}

function makeButton(label, action, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu_button ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

function createPager(className, ariaLabel, onJump) {
    const nav = document.createElement('nav');
    nav.className = `ps-pagination ${className}`;
    nav.setAttribute('aria-label', ariaLabel);
    const previous = makeButton('‹', () => requestJump(-1), 'ps-page-step');
    previous.setAttribute('aria-label', '上一页');
    const input = document.createElement('input');
    input.className = 'text_pole ps-page-input';
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.setAttribute('aria-label', `${ariaLabel}页码`);
    const total = document.createElement('span');
    total.className = 'ps-page-total';
    const requestJump = delta => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        onJump(Math.floor(value) + delta);
    };
    const jump = makeButton('跳转', () => requestJump(0), 'ps-page-jump');
    const next = makeButton('›', () => requestJump(1), 'ps-page-step');
    next.setAttribute('aria-label', '下一页');
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            requestJump(0);
        }
    });
    nav.append(previous, input, total, jump, next);
    return {
        element: nav,
        update(page, pageCount, itemCount) {
            input.value = String(page);
            input.max = String(pageCount);
            total.textContent = `/ ${pageCount} · ${itemCount} 条`;
            nav.hidden = pageCount <= 1;
            previous.disabled = page <= 1;
            next.disabled = page >= pageCount;
        },
    };
}

async function persist(data, characterId = activeCharacterId()) {
    if (characterId === null || characterId === undefined) return;
    await writeExtensionField(characterId, DATA_KEY, data);
    scheduleRender();
}

function presetNames() {
    try {
        return getManager()?.getAllPresets?.() ?? [];
    } catch {
        return [];
    }
}

function getLatestPreset(name) {
    try {
        const value = getManager()?.getCompletionPresetByName?.(name);
        return value && isObject(value) ? clone(value) : null;
    } catch {
        return null;
    }
}

function sourcePresetName(entry) {
    return entry.sourceName || entry.name;
}

function isCopyAlreadyApplied(entry) {
    if (getManager()?.getSelectedPresetName?.() !== sourcePresetName(entry)) return false;
    if (typeof chatCompletion.getChatCompletionPreset !== 'function' || !chatCompletion.settingsToUpdate) return false;
    const current = chatCompletion.getChatCompletionPreset();
    const preserveApi = getUiSettings().preserveApiSettings;
    return Object.entries(chatCompletion.settingsToUpdate).every(([key, definition]) => {
        if (definition?.[3] && (preserveApi || !chatCompletion.oai_settings?.bind_preset_to_connection)) return true;
        if (preserveApi && key === 'chat_completion_source') return true;
        if (key === 'extensions') return equal(comparableExtensions(current[key], entry.value[key]), comparableExtensions(entry.value[key], current[key]));
        return entry.value[key] === undefined || equal(current[key], entry.value[key]);
    });
}

async function applyPreset(name, characterId = activeCharacterId()) {
    if (characterId === null || characterId === undefined || selected_group || main_api !== 'openai' || activeCharacterId() !== characterId) return false;
    const data = readCardData(characterId);
    const entry = findBoundPreset(data, name);
    if (!entry) return false;
    if (applyingCharacterId !== null) return false;

    const manager = getManager();
    const sourceName = sourcePresetName(entry);
    const option = manager?.findPreset?.(sourceName);
    if (option === undefined || option === null) {
        toastr.warning(`酒馆中找不到预设“${sourceName}”`);
        scheduleRender();
        return false;
    }
    if (isCopyAlreadyApplied(entry)) {
        if (data.activeName !== name) {
            data.activeName = name;
            await persist(data, characterId);
        }
        return true;
    }

    applyingCharacterId = characterId;
    applyingEntryName = entry.name;
    applyingPreserveApiSettings = getUiSettings().preserveApiSettings;
    let onApplied;
    const completed = new Promise(resolve => { onApplied = resolve; });
    eventSource.once(event_types.OAI_PRESET_CHANGED_AFTER, onApplied);
    scheduleRender();
    try {
        await manager.selectPreset(option);
        // TauriTavern's selectPreset does not return the asynchronous application.
        await completed;
        data.activeName = name;
        await persist(data, characterId);
        return true;
    } catch (error) {
        console.error('[预设切换器] 应用预设失败', error);
        toastr.error(`应用预设“${name}”失败`);
        return false;
    } finally {
        eventSource.removeListener(event_types.OAI_PRESET_CHANGED_AFTER, onApplied);
        applyingCharacterId = null;
        applyingEntryName = null;
        applyingPreserveApiSettings = false;
        scheduleRender();
    }
}

async function applyGlobalPreset(name) {
    if (main_api !== 'openai') return false;
    const manager = getManager();
    const option = manager?.findPreset?.(name);
    if (option === undefined || option === null) {
        toastr.warning(`酒馆中找不到预设“${name}”`);
        return false;
    }
    if (manager.getSelectedPresetName?.() === name) return true;

    const preserveApi = getUiSettings().preserveApiSettings;
    const currentPreset = preserveApi && typeof chatCompletion.getChatCompletionPreset === 'function'
        ? chatCompletion.getChatCompletionPreset()
        : null;
    let onApplying;
    let onApplied;
    const beforeApply = ({ preset, settingsToUpdate }) => {
        if (!preserveApi || !isObject(preset) || !isObject(currentPreset)) return;
        for (const [key, definition] of Object.entries(settingsToUpdate ?? {})) {
            if (definition?.[3] !== true && key !== 'chat_completion_source') continue;
            if (Object.hasOwn(currentPreset, key)) preset[key] = clone(currentPreset[key]);
            else delete preset[key];
        }
    };
    const completed = new Promise(resolve => { onApplied = resolve; });
    onApplying = beforeApply;
    eventSource.once(event_types.OAI_PRESET_CHANGED_BEFORE, onApplying);
    eventSource.once(event_types.OAI_PRESET_CHANGED_AFTER, onApplied);
    try {
        await manager.selectPreset(option);
        await completed;
        return true;
    } catch (error) {
        console.error('[预设切换器] 应用全局预设失败', error);
        toastr.error(`应用预设“${name}”失败`);
        return false;
    } finally {
        eventSource.removeListener(event_types.OAI_PRESET_CHANGED_BEFORE, onApplying);
        eventSource.removeListener(event_types.OAI_PRESET_CHANGED_AFTER, onApplied);
    }
}

function getAtPath(value, path) {
    let current = value;
    for (const key of path) {
        if (Array.isArray(current)) {
            if (key === '$order') return current.map(getArrayKey).filter(Boolean);
            current = current.find(item => getArrayKey(item) === key);
            if (current === undefined) return MISSING;
        } else {
            if (!isObject(current) || !Object.hasOwn(current, key)) return MISSING;
            current = current[key];
        }
    }
    return current;
}

function getArrayKey(item) {
    if (!isObject(item)) return null;
    if (typeof item.identifier === 'string' && item.identifier) return `@${item.identifier}`;
    if (item.character_id !== undefined && item.character_id !== null) return `#${item.character_id}`;
    if (typeof item.id === 'string' && item.id) return `!${item.id}`;
    return null;
}

function setAtPath(value, path, replacement) {
    if (!path.length) return replacement === MISSING ? {} : clone(replacement);
    if (path.at(-1) === '$order') {
        const parent = getAtPath(value, path.slice(0, -1));
        if (Array.isArray(parent)) {
            const byKey = new Map(parent.map(item => [getArrayKey(item), item]).filter(([key]) => key));
            const ordered = (Array.isArray(replacement) ? replacement : []).map(key => byKey.get(key)).filter(Boolean);
            for (const item of parent) if (!ordered.includes(item)) ordered.push(item);
            parent.splice(0, parent.length, ...ordered);
        }
        return value;
    }
    let current = value;
    for (const key of path.slice(0, -1)) {
        if (Array.isArray(current)) {
            current = current.find(item => getArrayKey(item) === key);
            if (!current) return value;
        } else {
            if (!isObject(current[key]) && !Array.isArray(current[key])) current[key] = {};
            current = current[key];
        }
    }
    const last = path.at(-1);
    if (Array.isArray(current)) {
        const index = current.findIndex(item => getArrayKey(item) === last);
        if (replacement === MISSING) {
            if (index >= 0) current.splice(index, 1);
        } else if (index >= 0) current[index] = clone(replacement);
        else current.push(clone(replacement));
    } else if (replacement === MISSING) delete current[last];
    else current[last] = clone(replacement);
    return value;
}

function threeWayMerge(base, local, latest, path = [], conflicts = []) {
    if (equal(local, base)) return clone(latest);
    if (equal(latest, base)) return clone(local);
    if (equal(local, latest)) return clone(local);

    if (isObject(local) && isObject(latest) && (isObject(base) || base === MISSING)) {
        const baseline = base === MISSING ? {} : base;
        const merged = {};
        const keys = new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(latest)]);
        for (const key of keys) {
            const child = threeWayMerge(
                Object.hasOwn(baseline, key) ? baseline[key] : MISSING,
                Object.hasOwn(local, key) ? local[key] : MISSING,
                Object.hasOwn(latest, key) ? latest[key] : MISSING,
                [...path, key],
                conflicts,
            );
            if (child !== MISSING) merged[key] = child;
        }
        return merged;
    }

    if (Array.isArray(local) && Array.isArray(latest) && (Array.isArray(base) || base === MISSING)) {
        const baseline = base === MISSING ? [] : base;
        const keyed = [baseline, local, latest].every(items => {
            const keys = items.map(getArrayKey);
            return keys.every(Boolean) && new Set(keys).size === keys.length;
        });
        if (keyed) {
            const baseByKey = new Map(baseline.map(item => [getArrayKey(item), item]));
            const localByKey = new Map(local.map(item => [getArrayKey(item), item]));
            const latestByKey = new Map(latest.map(item => [getArrayKey(item), item]));
            const mergedByKey = new Map();
            const keys = new Set([...baseByKey.keys(), ...localByKey.keys(), ...latestByKey.keys()]);
            for (const key of keys) {
                const item = threeWayMerge(
                    baseByKey.has(key) ? baseByKey.get(key) : MISSING,
                    localByKey.has(key) ? localByKey.get(key) : MISSING,
                    latestByKey.has(key) ? latestByKey.get(key) : MISSING,
                    [...path, key],
                    conflicts,
                );
                if (item !== MISSING) mergedByKey.set(key, item);
            }

            const baseOrder = baseline.map(getArrayKey);
            const localOrder = local.map(getArrayKey);
            const latestOrder = latest.map(getArrayKey);
            let order;
            if (equal(localOrder, baseOrder)) order = latestOrder;
            else if (equal(latestOrder, baseOrder)) order = localOrder;
            else if (equal(localOrder, latestOrder)) order = localOrder;
            else {
                conflicts.push({ path: [...path, '$order'], base: baseOrder, local: localOrder, latest: latestOrder });
                order = localOrder;
            }
            const result = order.map(key => mergedByKey.get(key)).filter(Boolean);
            for (const [key, item] of mergedByKey) if (!result.includes(item)) result.push(item);
            return result;
        }
    }

    conflicts.push({
        path,
        base: clone(base),
        local: clone(local),
        latest: clone(latest),
    });
    return clone(local);
}

const CONFLICT_LABELS = {
    prompts: '提示词', prompt_order: '发送顺序', extensions: '扩展设置', baibaiToolkit: '柏宝箱',
    presetPromptGroups: '提示词分组', regexGroups: '正则分组', groups: '分组', groupId: '所属分组',
    name: '名称', content: '提示词内容', role: '发送身份', enabled: '启用开关', collapsed: '折叠状态',
    order: '顺序', system_prompt: '系统提示词', marker: '占位条目', temperature: '温度', top_p: 'Top P',
};

function conflictItemName(key, entry, latest) {
    const identifier = key.slice(1);
    if (key.startsWith('@')) return (latest.prompts ?? []).find(item => item.identifier === identifier)?.name
        || (entry.value.prompts ?? []).find(item => item.identifier === identifier)?.name || identifier;
    if (key.startsWith('!')) return readPromptGroups(entry.base)?.groups.find(group => group.id === identifier)?.name
        || readPromptGroups(entry.value)?.groups.find(group => group.id === identifier)?.name
        || readPromptGroups(latest)?.groups.find(group => group.id === identifier)?.name || identifier;
    return identifier;
}

function conflictValueText(value, entry, latest, key = '') {
    if (value === MISSING) return '（不存在／已删除）';
    if (value === null) return '（空值）';
    if (typeof value === 'boolean') return key === 'collapsed' ? (value ? '收起' : '展开') : (value ? '开启' : '关闭');
    if (typeof value === 'string') {
        if (key === 'role') return ({ system: '系统', user: '用户', assistant: '助手' })[value] ?? value;
        if (key === 'groupId') return conflictItemName(`!${value}`, entry, latest);
        return value || '（空文本）';
    }
    if (Array.isArray(value)) return value.map((item, i) => {
        const text = key === '$order' && typeof item === 'string' ? conflictItemName(item, entry, latest) : conflictValueText(item, entry, latest);
        return `${i + 1}. ${text}`;
    }).join('\n') || '（空列表）';
    if (isObject(value)) return Object.entries(value).map(([field, item]) => `${CONFLICT_LABELS[field] ?? field}：${conflictValueText(item, entry, latest, field)}`).join('\n') || '（空对象）';
    return String(value);
}

function appendChangedText(element, text, baseline) {
    let start = 0;
    while (start < text.length && start < baseline.length && text[start] === baseline[start]) start++;
    let end = text.length;
    let baseEnd = baseline.length;
    while (end > start && baseEnd > start && text[end - 1] === baseline[baseEnd - 1]) { end--; baseEnd--; }
    element.append(document.createTextNode(text.slice(0, start)));
    if (end > start) {
        const changed = document.createElement('mark');
        changed.textContent = text.slice(start, end);
        element.append(changed);
    } else if (text !== baseline) {
        const removed = document.createElement('mark');
        removed.textContent = '〔此处有删除〕';
        element.append(removed);
    }
    element.append(document.createTextNode(text.slice(end)));
}

function showEditorHelp(helpText, modeOptions = null) {
    const { body, footer, close } = createDialog('条目编辑说明', '');
    const message = document.createElement('p');
    message.className = 'ps-help-message';
    message.textContent = helpText;
    body.append(message);
    if (modeOptions) {
        const modeSection = document.createElement('section');
        modeSection.className = 'ps-help-mode-section';
        const modeTitle = document.createElement('h4');
        modeTitle.textContent = '编辑模式';
        const modeGroup = document.createElement('div');
        modeGroup.className = 'ps-help-modes';
        const updateMode = () => {
            const enabled = modeOptions.getEnabled();
            for (const button of modeGroup.querySelectorAll('button')) {
                const selected = button.dataset.mode === String(enabled);
                button.classList.toggle('ps-selected', selected);
                button.setAttribute('aria-pressed', String(selected));
            }
        };
        for (const [enabled, label] of [[false, '仅编辑'], [true, '完整']]) {
            const button = makeButton(label, () => {
                modeOptions.onChange(enabled);
                updateMode();
            }, 'ps-mode-button');
            button.dataset.mode = String(enabled);
            modeGroup.append(button);
        }
        modeSection.append(modeTitle, modeGroup);
        body.append(modeSection);
        updateMode();

        const pagingSection = document.createElement('section');
        pagingSection.className = 'ps-help-mode-section';
        const pagingTitle = document.createElement('h4');
        pagingTitle.textContent = '条目分页';
        const settings = getUiSettings();
        const addSwitch = (text, checked, onChange) => {
            const row = document.createElement('label');
            row.className = 'ps-help-setting';
            const caption = document.createElement('span');
            caption.textContent = text;
            const toggle = document.createElement('span');
            toggle.className = 'ps-entry-toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('role', 'switch');
            input.checked = checked;
            input.addEventListener('change', () => onChange(input.checked));
            toggle.append(input);
            row.append(caption, toggle);
            pagingSection.append(row);
        };
        const sizeRow = document.createElement('label');
        sizeRow.className = 'ps-help-setting';
        const sizeCaption = document.createElement('span');
        sizeCaption.textContent = '每页条目数（1–500）';
        const sizeInput = document.createElement('input');
        sizeInput.className = 'text_pole ps-help-page-size';
        sizeInput.type = 'number';
        sizeInput.min = '1';
        sizeInput.max = '500';
        sizeInput.step = '1';
        sizeInput.value = String(settings.promptPageSize);
        sizeInput.disabled = !settings.customPromptPageSize;
        sizeInput.addEventListener('change', () => {
            const count = Number(sizeInput.value);
            if (!Number.isInteger(count) || count < 1 || count > 500) {
                sizeInput.setCustomValidity('请输入 1 到 500 的整数');
                sizeInput.reportValidity();
                return;
            }
            sizeInput.setCustomValidity('');
            saveUiSettings({ promptPageSize: count });
            modeOptions.onPagingChange();
        });
        sizeInput.addEventListener('input', () => sizeInput.setCustomValidity(''));
        pagingSection.append(pagingTitle);
        addSwitch('自定义每页条目数', settings.customPromptPageSize, enabled => {
            sizeInput.disabled = !enabled;
            saveUiSettings({ customPromptPageSize: enabled });
            modeOptions.onPagingChange();
        });
        sizeRow.append(sizeCaption, sizeInput);
        pagingSection.append(sizeRow);
        addSwitch('翻页自动回到顶部', settings.promptPageAutoTop, enabled => {
            saveUiSettings({ promptPageAutoTop: enabled });
        });
        const pagingHint = document.createElement('p');
        pagingHint.className = 'ps-editor-hint';
        pagingHint.textContent = '设置自动记住并跨角色使用。关闭自定义后每页显示 15 条；这些设置不会修改预设副本。';
        pagingSection.append(pagingHint);
        body.append(pagingSection);
    }
    footer.append(makeButton('知道了', close, 'ps-primary'));
}

function createDialog(title, description, { helpText = '', modeOptions = null } = {}) {
    const backdrop = document.createElement('div');
    backdrop.className = 'ps-dialog-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'ps-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const titlebar = document.createElement('div');
    titlebar.className = 'ps-dialog-titlebar';
    titlebar.append(heading);
    if (helpText) {
        const help = document.createElement('button');
        help.type = 'button';
        help.className = 'ps-editor-help';
        help.setAttribute('aria-label', '条目编辑说明');
        help.title = '查看条目编辑说明';
        help.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M9.8 9a2.3 2.3 0 1 1 3.9 1.6c-1.2 1.1-1.7 1.4-1.7 3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path><circle cx="12" cy="17" r="1" fill="currentColor"></circle></svg>';
        help.addEventListener('click', () => showEditorHelp(helpText, modeOptions));
        titlebar.append(help);
    }
    const detail = document.createElement('p');
    detail.className = 'ps-dialog-description';
    detail.textContent = description;
    detail.hidden = !description;
    const body = document.createElement('div');
    body.className = 'ps-dialog-body';
    const footer = document.createElement('div');
    footer.className = 'ps-dialog-footer';
    dialog.append(titlebar, detail, body, footer);
    backdrop.append(dialog);
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', event => {
        if (event.target === backdrop) close();
    });
    return { backdrop, body, footer, close };
}

function openEditor(entry) {
    const characterId = activeCharacterId();
    const helpText = '在列表直接调整条目开关，可连续修改多条后统一保存；点击名称编辑内容。柏宝箱分组支持折叠和整组开关；整组停用不改变成员各自的开关。搜索会显示折叠组中的匹配条目。收藏会跨角色显示；保存只修改当前角色卡的这个副本。仅编辑模式不会改变条目结构；完整模式可新建、删除条目，并长按拖动手柄调整顺序，拖到其他组的条目旁会加入该组。列表支持输入页码跳转。';
    const modeOptions = {
        getEnabled: () => manageMode,
        onChange: enabled => setManageMode(enabled),
        onPagingChange: () => {
            const nextSize = getPromptPageSize();
            if (nextSize === promptPageSize) return;
            const firstIndex = (promptPage - 1) * promptPageSize;
            promptPageSize = nextSize;
            promptPage = Math.floor(firstIndex / promptPageSize) + 1;
            renderRows(false);
            list.scrollTop = 0;
        },
    };
    const { backdrop, body, footer, close } = createDialog(`编辑「${entry.name}」的角色专属版本`, '', { helpText, modeOptions });
    backdrop.querySelector('.ps-dialog').classList.add('ps-prompt-editor');
    backdrop.querySelector('.ps-dialog-description').hidden = true;
    body.classList.add('ps-editor-dialog-body');
    const prompts = clone(Array.isArray(entry.value.prompts) ? entry.value.prompts : []);
    const orderGroups = clone(Array.isArray(entry.value.prompt_order) ? entry.value.prompt_order : []);
    const originalPrompts = clone(prompts);
    const originalOrderGroups = clone(orderGroups);
    let promptGroups = readPromptGroups(entry.value);
    let originalPromptGroups = clone(promptGroups);
    let promptGroupById = new Map((promptGroups?.groups ?? []).map(group => [group.id, group]));
    const foldKey = JSON.stringify([characters?.[characterId]?.avatar ?? characterId, entry.name]);
    const savedFolds = getUiSettings().editorCollapsedGroups[foldKey];
    const collapsedGroupIds = new Set(Array.isArray(savedFolds) ? savedFolds : (promptGroups?.groups ?? []).filter(group => group.collapsed).map(group => group.id));
    const favoriteKey = 'preset-switcher:favorites:v1';
    const readFavorites = () => {
        try {
            const data = JSON.parse(localStorage.getItem(favoriteKey) ?? '[]');
            return new Set(Array.isArray(data) ? data.filter(item => typeof item === 'string') : []);
        } catch {
            return new Set();
        }
    };
    const favorites = readFavorites();
    let selectedIdentifier = null;
    let query = '';
    let favoritesOnly = false;
    let manageMode = false;
    let dirty = false;
    let structureDirty = false;
    let draftIdentifier = null;
    let draft = null;
    let draftBaseline = null;
    let promptPage = 1;
    let promptPageSize = getPromptPageSize();
    const enabledOverrides = new Map();
    backdrop.addEventListener('click', event => {
        if (event.target !== backdrop || !hasPendingChanges()) return;
        event.stopImmediatePropagation();
        if (window.confirm('当前副本有未保存修改，确定关闭并丢弃吗？')) close();
    }, true);

    const workspace = document.createElement('div');
    workspace.className = 'ps-prompt-workspace ps-list-view';
    const browser = document.createElement('section');
    browser.className = 'ps-prompt-browser';
    const search = document.createElement('input');
    search.className = 'text_pole ps-prompt-search';
    search.type = 'search';
    search.placeholder = '搜索条目名称…';
    search.setAttribute('aria-label', '搜索提示词条目');
    const browserToolbar = document.createElement('div');
    browserToolbar.className = 'ps-prompt-browser-toolbar';
    const favoriteFilter = makeButton('☆ 只看收藏', () => {
        favoritesOnly = !favoritesOnly;
        favoriteFilter.classList.toggle('ps-selected', favoritesOnly);
        renderRows(true);
    });
    const resultCount = document.createElement('span');
    resultCount.className = 'ps-result-count';
    const addPromptButton = makeButton('+ 新建条目', addPrompt, 'ps-add-prompt');
    addPromptButton.hidden = true;
    browserToolbar.append(favoriteFilter, addPromptButton, resultCount);
    const list = document.createElement('div');
    list.className = 'ps-entry-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '提示词条目');
    const promptPager = createPager('ps-prompt-pager', '条目列表', page => {
        const previousPage = promptPage;
        const previousScroll = list.scrollTop;
        promptPage = page;
        renderRows(false);
        if (promptPage !== previousPage && getUiSettings().promptPageAutoTop) {
            list.scrollTop = 0;
            body.scrollTop = 0;
        } else {
            list.scrollTop = previousScroll;
        }
    });
    browser.append(search, browserToolbar, list, promptPager.element);

    const detail = document.createElement('section');
    detail.className = 'ps-prompt-detail';
    workspace.append(browser, detail);
    body.append(workspace);

    const navigationButton = makeButton('关闭', () => {
        if (!workspace.classList.contains('ps-list-view')) {
            returnToList();
            return;
        }
        if (hasPendingChanges() && !window.confirm('当前副本有未保存修改，确定关闭并丢弃吗？')) return;
        close();
    });

    function showPromptDetail() {
        workspace.classList.remove('ps-list-view');
        workspace.classList.add('ps-mobile-detail');
        navigationButton.textContent = '返回';
    }

    function returnToList() {
        workspace.classList.remove('ps-mobile-detail');
        workspace.classList.add('ps-list-view');
        navigationButton.textContent = '关闭';
    }

    function selectedPrompt() {
        if (draftIdentifier === selectedIdentifier && draft) return draft;
        return prompts.find(prompt => prompt?.identifier === selectedIdentifier) ?? null;
    }

    function isEnabled(identifier) {
        if (enabledOverrides.has(identifier)) return enabledOverrides.get(identifier);
        return savedEnabled(identifier);
    }

    function savedEnabled(identifier) {
        const rows = editorOrderGroup()?.order ?? [];
        return rows.find(row => row.identifier === identifier)?.enabled !== false;
    }

    function editorOrderGroup() {
        const configuration = chatCompletion.promptManager?.configuration?.promptOrder;
        const id = configuration?.strategy === 'character'
            ? chatCompletion.promptManager?.activeCharacter?.id
            : configuration?.dummyId ?? 100001;
        return orderGroups.find(group => String(group.character_id) === String(id))
            ?? orderGroups.find(group => group.order?.length)
            ?? orderGroups[0];
    }

    function hasPendingChanges() {
        return dirty || structureDirty || enabledOverrides.size > 0 || !equal(promptGroups, originalPromptGroups);
    }

    function setPromptEnabled(identifier, enabled) {
        if (enabled === savedEnabled(identifier)) enabledOverrides.delete(identifier);
        else enabledOverrides.set(identifier, enabled);
        for (const row of list.querySelectorAll('.ps-entry-row')) {
            if (row.dataset.identifier !== identifier) continue;
            const checkbox = row.querySelector('.ps-entry-toggle input');
            checkbox.checked = enabled;
            checkbox.parentElement.title = `${enabled ? '条目已启用，点击停用' : '条目已停用，点击启用'}${getPromptGroup(identifier)?.enabled === false ? '；所属分组已停用' : ''}`;
        }
        if (draftIdentifier === identifier) {
            const checkbox = detail.querySelector('.ps-entry-enabled input');
            if (checkbox) checkbox.checked = enabled;
        }
    }

    function refreshDraftDirty() {
        if (!draft || !draftIdentifier || !draftBaseline) {
            dirty = false;
            return;
        }
        dirty = !equal(draft, draftBaseline);
    }

    function refreshStructureDirty() {
        structureDirty = !equal(prompts, originalPrompts) || !equal(orderGroups, originalOrderGroups);
    }

    function setManageMode(enabled) {
        manageMode = enabled;
        addPromptButton.hidden = !enabled;
        list.classList.toggle('ps-manage-mode', enabled);
        renderRows(false);
    }

    function commitDraftToPrompts() {
        if (!draft || !draftIdentifier) return;
        const index = prompts.findIndex(prompt => prompt?.identifier === draftIdentifier);
        if (index < 0) return;
        const value = clone(draft);
        prompts[index] = value;
    }

    function toggleFavorite(identifier) {
        if (!identifier) return;
        if (favorites.has(identifier)) favorites.delete(identifier);
        else favorites.add(identifier);
        try {
            localStorage.setItem(favoriteKey, JSON.stringify([...favorites]));
        } catch (error) {
            toastr.warning(`无法保存收藏：${error.message}`);
        }
        renderRows(false);
        renderDetail();
    }

    function filteredPrompts() {
        const needle = query.trim().toLocaleLowerCase();
        const byId = new Map(prompts.map(prompt => [prompt?.identifier, prompt]));
        const orderedIds = [...new Set((editorOrderGroup()?.order ?? []).map(row => row.identifier))];
        const ordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
        const included = new Set(orderedIds);
        ordered.push(...prompts.filter(prompt => !included.has(prompt?.identifier)));
        const matches = ordered.filter(prompt => {
            if (!prompt?.identifier) return false;
            if (favoritesOnly && !favorites.has(prompt.identifier)) return false;
            const name = draftIdentifier === prompt.identifier && draft ? draft.name : prompt.name;
            const group = getPromptGroup(prompt.identifier);
            return !needle || String(name ?? '').toLocaleLowerCase().includes(needle) || String(prompt.identifier).toLocaleLowerCase().includes(needle) || group?.name.toLocaleLowerCase().includes(needle);
        });
        return matches;
    }

    function getPromptGroup(identifier) {
        const groupId = promptGroups?.prompts?.[identifier]?.groupId;
        return promptGroupById.get(groupId) ?? null;
    }

    function renderGroupHeader(group, pageCount, totalCount) {
        const header = document.createElement('div');
        header.className = 'ps-group-header';
        header.dataset.groupId = group?.id ?? '';
        const expanded = !group || !collapsedGroupIds.has(group.id) || Boolean(query.trim()) || favoritesOnly;
        const title = makeButton(`${expanded ? '▾' : '▸'} ${group?.name ?? '未分组'}`, () => {
            if (!group) return;
            if (collapsedGroupIds.has(group.id)) collapsedGroupIds.delete(group.id);
            else collapsedGroupIds.add(group.id);
            saveUiSettings({ editorCollapsedGroups: { ...getUiSettings().editorCollapsedGroups, [foldKey]: [...collapsedGroupIds] } });
            renderRows(false);
        }, 'ps-group-title');
        title.disabled = !group;
        title.setAttribute('aria-expanded', String(expanded));
        const count = document.createElement('span');
        count.className = 'ps-result-count';
        count.textContent = pageCount === totalCount ? `${totalCount} 条` : `本段 ${pageCount} / ${totalCount} 条`;
        header.append(title, count);
        if (group) {
            const toggle = document.createElement('label');
            toggle.className = 'ps-entry-toggle';
            toggle.title = '需开启柏宝箱的预设分组；整组开关不改变成员各自的开关';
            const enabled = document.createElement('input');
            enabled.type = 'checkbox';
            enabled.setAttribute('role', 'switch');
            enabled.setAttribute('aria-label', `启用分组${group.name}`);
            enabled.checked = group.enabled !== false;
            enabled.addEventListener('change', () => {
                group.enabled = enabled.checked;
                renderRows(false);
                renderDetail();
            });
            toggle.append(enabled);
            header.append(toggle);
        }
        list.append(header);
        return expanded;
    }

    function renderRows(resetPage) {
        if (resetPage) {
            promptPage = 1;
            list.scrollTop = 0;
        }
        const filtered = filteredPrompts();
        const pageCount = Math.max(1, Math.ceil(filtered.length / promptPageSize));
        promptPage = Math.min(pageCount, Math.max(1, promptPage));
        const start = (promptPage - 1) * promptPageSize;
        const pageItems = filtered.slice(start, start + promptPageSize);
        resultCount.textContent = `${filtered.length} 条`;
        promptPager.update(promptPage, pageCount, filtered.length);
        list.replaceChildren();
        list.classList.toggle('ps-manage-mode', manageMode);

        const totalCounts = new Map();
        for (const prompt of filtered) {
            const id = getPromptGroup(prompt.identifier)?.id ?? '';
            totalCounts.set(id, (totalCounts.get(id) ?? 0) + 1);
        }
        let previousGroupId;
        let segmentExpanded = true;

        for (const [index, prompt] of pageItems.entries()) {
            const group = getPromptGroup(prompt.identifier);
            const groupId = group?.id ?? '';
            if (promptGroups?.groups.length && previousGroupId !== groupId) {
                previousGroupId = groupId;
                let segmentCount = 1;
                while (index + segmentCount < pageItems.length && (getPromptGroup(pageItems[index + segmentCount].identifier)?.id ?? '') === groupId) segmentCount++;
                segmentExpanded = renderGroupHeader(group, segmentCount, totalCounts.get(groupId));
            }
            if (!segmentExpanded) continue;
            const displayName = draftIdentifier === prompt.identifier && draft ? draft.name : prompt.name;
            const row = document.createElement('div');
            row.className = `ps-entry-row${prompt.identifier === selectedIdentifier ? ' ps-entry-row-selected' : ''}`;
            row.dataset.identifier = prompt.identifier;
            row.dataset.groupId = groupId;
            row.classList.toggle('ps-group-disabled', group?.enabled === false);
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(prompt.identifier === selectedIdentifier));
            const handle = makeButton('⠿', () => {}, 'ps-drag-handle');
            handle.title = prompt.marker ? '酒馆自动生成的条目不能拖动' : '长按后拖动到目标位置';
            handle.setAttribute('aria-label', `长按拖动${displayName || '未命名提示词'}`);
            handle.hidden = !manageMode;
            handle.disabled = Boolean(prompt.marker);
            attachLongPressDrag(handle, row, prompt);

            const select = makeButton(displayName || '未命名提示词', () => {
                if (selectedIdentifier === prompt.identifier) {
                    showPromptDetail();
                    return;
                }
                if (dirty && !window.confirm('当前条目有未保存修改，切换后会丢弃这条修改。继续吗？')) return;
                selectedIdentifier = prompt.identifier;
                dirty = false;
                draftIdentifier = null;
                draft = null;
                draftBaseline = null;
                renderRows(false);
                renderDetail();
                showPromptDetail();
            }, 'ps-entry-select');
            select.title = displayName || prompt.identifier;
            if (group?.enabled === false) select.title += '（所属分组已停用）';
            const star = makeButton(favorites.has(prompt.identifier) ? '★' : '☆', () => toggleFavorite(prompt.identifier), 'ps-entry-star');
            star.title = favorites.has(prompt.identifier) ? '取消收藏' : '收藏条目';
            const toggle = document.createElement('label');
            toggle.className = 'ps-entry-toggle';
            toggle.title = `${isEnabled(prompt.identifier) ? '条目已启用，点击停用' : '条目已停用，点击启用'}${group?.enabled === false ? '；所属分组已停用' : ''}`;
            const enabled = document.createElement('input');
            enabled.type = 'checkbox';
            enabled.setAttribute('role', 'switch');
            enabled.checked = isEnabled(prompt.identifier);
            enabled.setAttribute('aria-label', `启用${displayName || '未命名提示词'}`);
            enabled.addEventListener('change', () => setPromptEnabled(prompt.identifier, enabled.checked));
            toggle.append(enabled);
            const remove = makeButton('', () => removePrompt(prompt), 'ps-delete-prompt ps-danger');
            remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></svg>';
            remove.setAttribute('aria-label', `删除${prompt.name || '未命名提示词'}`);
            remove.hidden = !manageMode;
            remove.disabled = Boolean(prompt.marker);
            remove.title = prompt.marker ? '酒馆自动生成的条目不能删除' : '从当前角色卡预设副本中删除';
            row.append(handle, select, star, toggle, remove);
            list.append(row);
        }
    }

    function setEnabledInValue(value, identifier, enabled) {
        if (!Array.isArray(value.prompt_order) || value.prompt_order.length === 0) {
            value.prompt_order = [{ character_id: 100000, order: [] }];
        }
        for (const group of value.prompt_order) {
            if (!Array.isArray(group.order)) group.order = [];
            const row = group.order.find(item => item.identifier === identifier);
            if (row) row.enabled = enabled;
            else group.order.push({ identifier, enabled });
        }
    }

    function ensureOrderGroups() {
        if (!orderGroups.length) orderGroups.push({ character_id: 100000, order: [] });
        for (const group of orderGroups) {
            if (!Array.isArray(group.order)) group.order = [];
        }
    }

    function addPrompt() {
        commitDraftToPrompts();
        const identifier = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `preset-switcher-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const prompt = {
            identifier,
            name: '新建提示词',
            role: 'system',
            system_prompt: true,
            content: '',
            marker: false,
        };
        prompts.push(prompt);
        ensureOrderGroups();
        for (const group of orderGroups) group.order.push({ identifier, enabled: true });
        selectedIdentifier = identifier;
        draftIdentifier = null;
        draft = null;
        draftBaseline = null;
        dirty = false;
        refreshStructureDirty();
        promptPage = Math.ceil(prompts.length / promptPageSize);
        renderRows(false);
        renderDetail();
        showPromptDetail();
    }

    function removePrompt(prompt) {
        if (prompt.marker) return;
        if (dirty && !window.confirm('当前条目有未保存修改，继续删除会丢弃这条修改。是否继续？')) return;
        if (!window.confirm(`从当前角色卡预设副本中删除「${prompt.name || '未命名提示词'}」？`)) return;
        if (dirty) {
            dirty = false;
            draftIdentifier = null;
            draft = null;
            draftBaseline = null;
        }
        const index = prompts.findIndex(item => item?.identifier === prompt.identifier);
        if (index < 0) return;
        prompts.splice(index, 1);
        for (const group of orderGroups) group.order = (group.order ?? []).filter(item => item.identifier !== prompt.identifier);
        enabledOverrides.delete(prompt.identifier);
        if (promptGroups) delete promptGroups.prompts[prompt.identifier];
        if (selectedIdentifier === prompt.identifier) {
            selectedIdentifier = prompts[Math.min(index, prompts.length - 1)]?.identifier ?? null;
            draftIdentifier = null;
            draft = null;
            draftBaseline = null;
            dirty = false;
        }
        refreshStructureDirty();
        renderRows(false);
        renderDetail();
    }

    function reorderPrompt(identifier, targetIdentifier, afterTarget) {
        if (!manageMode || !identifier || !targetIdentifier || identifier === targetIdentifier) return;
        commitDraftToPrompts();
        if (!prompts.some(prompt => prompt.identifier === identifier) || !prompts.some(prompt => prompt.identifier === targetIdentifier)) return;
        // Move only this reference in each order list, preserving every other
        // prompt's relative position; prompts is the definition catalogue.
        for (const group of orderGroups) {
            const order = group.order ?? [];
            const from = order.findIndex(item => item.identifier === identifier);
            if (from < 0 || !order.some(item => item.identifier === targetIdentifier)) continue;
            const [moved] = order.splice(from, 1);
            const to = order.findIndex(item => item.identifier === targetIdentifier);
            order.splice(to + (afterTarget ? 1 : 0), 0, moved);
        }
        if (promptGroups) {
            const groupId = getPromptGroup(targetIdentifier)?.id;
            if (groupId) promptGroups.prompts[identifier] = { groupId };
            else delete promptGroups.prompts[identifier];
        }
        draftIdentifier = null;
        draft = null;
        draftBaseline = null;
        dirty = false;
        refreshStructureDirty();
        renderRows(false);
        renderDetail();
    }

    function attachLongPressDrag(handle, row, prompt) {
        if (!manageMode || prompt.marker) return;
        let holdTimer = null;
        let startPoint = null;
        let activePointerId = null;
        let dragging = false;
        const clearHold = () => {
            if (holdTimer !== null) clearTimeout(holdTimer);
            holdTimer = null;
        };
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            startPoint = { x: event.clientX, y: event.clientY };
            activePointerId = event.pointerId;
            holdTimer = setTimeout(() => {
                dragging = true;
                row.classList.add('ps-row-dragging');
                try { handle.setPointerCapture(activePointerId); } catch { /* Pointer may already have been released. */ }
            }, 450);
        });
        handle.addEventListener('pointermove', event => {
            if (activePointerId !== event.pointerId) return;
            if (!dragging && startPoint && Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > 10) {
                clearHold();
                return;
            }
            if (!dragging) return;
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.ps-entry-row');
            for (const item of list.querySelectorAll('.ps-drop-before, .ps-drop-after')) item.classList.remove('ps-drop-before', 'ps-drop-after');
            if (target && target !== row && list.contains(target)) {
                const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
                target.classList.add(after ? 'ps-drop-after' : 'ps-drop-before');
                handle.dataset.dropIdentifier = target.dataset.identifier;
                handle.dataset.dropAfter = String(after);
            } else {
                delete handle.dataset.dropIdentifier;
                delete handle.dataset.dropAfter;
            }
        });
        const finish = event => {
            if (activePointerId !== event.pointerId) return;
            clearHold();
            if (dragging) {
                const targetIdentifier = handle.dataset.dropIdentifier;
                const afterTarget = handle.dataset.dropAfter === 'true';
                for (const item of list.querySelectorAll('.ps-row-dragging, .ps-drop-before, .ps-drop-after')) item.classList.remove('ps-row-dragging', 'ps-drop-before', 'ps-drop-after');
                delete handle.dataset.dropIdentifier;
                delete handle.dataset.dropAfter;
                if (targetIdentifier) reorderPrompt(prompt.identifier, targetIdentifier, afterTarget);
            }
            dragging = false;
            startPoint = null;
            activePointerId = null;
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
    }

    function renderDetail() {
        detail.replaceChildren();
        const prompt = selectedPrompt();
        if (!prompt) {
            const empty = document.createElement('p');
            empty.className = 'ps-empty';
            empty.textContent = prompts.length ? '从左侧选择一个条目。' : '这个预设没有提示词条目。';
            detail.append(empty);
            return;
        }
        if (draftIdentifier !== prompt.identifier) {
            draftIdentifier = prompt.identifier;
            draft = clone(prompt);
            draftBaseline = clone(prompt);
            dirty = false;
        }
        const editablePrompt = selectedPrompt();
        const group = getPromptGroup(prompt.identifier);

        const titleRow = document.createElement('div');
        titleRow.className = 'ps-prompt-detail-title';
        const title = document.createElement('h4');
        title.textContent = editablePrompt.name || '未命名提示词';
        const favorite = makeButton(favorites.has(prompt.identifier) ? '★ 已收藏' : '☆ 收藏条目', () => toggleFavorite(prompt.identifier));
        titleRow.append(title, favorite);

        const form = document.createElement('div');
        form.className = 'ps-single-prompt-form';
        const name = document.createElement('input');
        name.className = 'text_pole';
        name.value = editablePrompt.name ?? '';
        name.setAttribute('aria-label', '条目名称');
        name.readOnly = Boolean(editablePrompt.marker);
        if (editablePrompt.marker) {
            name.classList.add('ps-marker-name');
            name.title = '酒馆自动生成的占位条目名称不可修改';
        }
        name.addEventListener('input', () => {
            if (editablePrompt.marker) return;
            editablePrompt.name = name.value;
            title.textContent = name.value || '未命名提示词';
            refreshDraftDirty();
            renderRows(false);
        });
        form.append(field('名称', name));

        const role = document.createElement('select');
        role.className = 'text_pole';
        for (const [value, label] of [['system', '系统'], ['user', '用户'], ['assistant', '助手']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            role.append(option);
        }
        role.value = ['system', 'user', 'assistant'].includes(editablePrompt.role) ? editablePrompt.role : (editablePrompt.system_prompt ? 'system' : 'user');
        role.disabled = Boolean(editablePrompt.marker);
        role.addEventListener('change', () => {
            editablePrompt.role = role.value;
            editablePrompt.system_prompt = role.value === 'system';
            refreshDraftDirty();
        });
        form.append(field('发送身份', role));

        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.checked = isEnabled(editablePrompt.identifier);
        enabled.addEventListener('change', () => {
            setPromptEnabled(editablePrompt.identifier, enabled.checked);
        });
        const enabledLabel = document.createElement('label');
        enabledLabel.className = 'ps-entry-enabled';
        enabledLabel.append(enabled, document.createTextNode('启用此条目'));
        form.append(enabledLabel);
        if (group) {
            const groupHint = document.createElement('p');
            groupHint.className = 'ps-editor-hint';
            groupHint.textContent = `所属分组：${group.name}${group.enabled === false ? ' · 已停用，开启柏宝箱预设分组时，即使条目开关开启也不会生效' : ''}。整组开关可在列表中调整。`;
            form.append(groupHint);
        }

        if (editablePrompt.marker) {
            const note = document.createElement('p');
            note.className = 'ps-editor-hint';
            note.textContent = '这是酒馆自动生成的占位条目。名称不可修改，也没有可直接编辑的提示词内容。';
            form.append(note);
        } else {
            const content = document.createElement('textarea');
            content.className = 'text_pole ps-prompt-content';
            content.value = editablePrompt.content ?? '';
            content.setAttribute('aria-label', '提示词内容');
            content.addEventListener('input', () => { editablePrompt.content = content.value; refreshDraftDirty(); });
            form.append(field('内容', content));
        }
        detail.append(titleRow, form);
    }

    function field(label, control) {
        const wrapper = document.createElement('label');
        wrapper.className = 'ps-field';
        const caption = document.createElement('span');
        caption.className = 'ps-field-label';
        caption.textContent = label;
        wrapper.append(caption, control);
        return wrapper;
    }

    search.addEventListener('input', () => {
        query = search.value;
        renderRows(true);
    });
    renderRows(true);
    renderDetail();

    footer.append(
        navigationButton,
        makeButton('保存修改', async () => {
            if (!hasPendingChanges()) {
                toastr.info('内容与打开时一致，没有需要保存的修改');
                return;
            }
            try {
                const data = readCardData(characterId);
                const target = findBoundPreset(data, entry.name);
                if (!target) throw new Error('这个预设已从角色卡解绑');
                const current = clone(target.value);
                if (structureDirty) {
                    commitDraftToPrompts();
                    current.prompts = clone(prompts);
                    current.prompt_order = clone(orderGroups);
                } else if (dirty && draftIdentifier && draft) {
                    const index = current.prompts?.findIndex(item => item?.identifier === draftIdentifier) ?? -1;
                    if (index < 0) throw new Error('当前角色卡里已找不到这条目，请重新打开编辑器');
                    const updatedPrompt = clone(draft);
                    current.prompts[index] = updatedPrompt;
                }
                for (const [identifier, enabled] of enabledOverrides) setEnabledInValue(current, identifier, enabled);
                if (!equal(promptGroups, originalPromptGroups)) writePromptGroups(current, promptGroups);
                target.value = current;
                await persist(data, characterId);
                entry.value = current;
                const savedPrompt = current.prompts?.find(item => item?.identifier === selectedIdentifier) ?? null;
                prompts.splice(0, prompts.length, ...(current.prompts ?? []));
                orderGroups.splice(0, orderGroups.length, ...(current.prompt_order ?? []));
                originalPrompts.splice(0, originalPrompts.length, ...clone(prompts));
                originalOrderGroups.splice(0, originalOrderGroups.length, ...clone(orderGroups));
                enabledOverrides.clear();
                promptGroups = readPromptGroups(current);
                originalPromptGroups = clone(promptGroups);
                promptGroupById = new Map((promptGroups?.groups ?? []).map(group => [group.id, group]));
                draft = savedPrompt ? clone(savedPrompt) : null;
                draftIdentifier = savedPrompt?.identifier ?? null;
                draftBaseline = savedPrompt ? clone(savedPrompt) : null;
                dirty = false;
                structureDirty = false;
                renderRows(false);
                renderDetail();
                if (data.activeName === entry.name && activeCharacterId() === characterId) await applyPreset(entry.name, characterId);
                toastr.success('已保存到当前角色卡预设副本');
            } catch (error) {
                toastr.error(`无法保存：${error.message}`);
            }
        }, 'ps-primary'),
    );
}

function openConflictResolver(entry, latest, merged, conflicts) {
    const characterId = activeCharacterId();
    const { body, footer, close } = createDialog(
        `处理「${entry.name}」的 ${conflicts.length} 项冲突`,
        '同一项设置在角色副本和原预设两边都改过，结果不同。高亮显示相对上次同步变化的部分，请逐项选择保留哪一边。未冲突的修改会自动合并。',
    );
    const controls = [];

    for (const conflict of conflicts) {
        const row = document.createElement('article');
        row.className = 'ps-conflict';
        const path = document.createElement('h4');
        path.textContent = conflict.path.map((part, index) => {
            if (conflict.path.includes('presetPromptGroups') && ['extensions', 'baibaiToolkit', 'groups'].includes(part) && index < conflict.path.length - 1) return '';
            if (part === 'presetPromptGroups') return '柏宝箱分组';
            if (part === '$order') return '排列顺序';
            if (part.startsWith('@')) {
                return `条目「${conflictItemName(part, entry, latest)}」`;
            }
            if (part.startsWith('#')) return `排序组 ${part.slice(1)}`;
            if (part.startsWith('!')) {
                return `分组「${conflictItemName(part, entry, latest)}」`;
            }
            if (index > 0 && conflict.path[index - 1] === 'prompts') return `条目「${conflictItemName(`@${part}`, entry, latest)}」`;
            return CONFLICT_LABELS[part] ?? part;
        }).filter(Boolean).join(' · ') || '（根对象）';
        const key = conflict.path.at(-1);
        const baselineText = conflictValueText(conflict.base, entry, latest, key);
        const compare = document.createElement('div');
        compare.className = 'ps-conflict-compare';
        const select = document.createElement('select');
        select.className = 'text_pole';
        select.setAttribute('aria-label', `${path.textContent}的处理方式`);
        const choices = [['', '请选择处理方式'], ['local', '保留角色副本'], ['latest', '采用原预设最新版'], ['custom', '手动修改结果']];
        if (conflict.path.at(-1) !== '$order') choices.push(['delete', '删除该字段']);
        for (const [value, label] of choices) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            if (!value) {
                option.disabled = true;
                option.selected = true;
            }
            select.append(option);
        }
        for (const [value, title, data] of [['local', '角色副本 · 你的修改', conflict.local], ['latest', '原预设 · 最新修改', conflict.latest]]) {
            const card = document.createElement('section');
            card.className = 'ps-conflict-value';
            card.dataset.choice = value;
            const heading = document.createElement('strong');
            heading.textContent = title;
            const text = document.createElement('pre');
            appendChangedText(text, conflictValueText(data, entry, latest, key), baselineText);
            const choose = makeButton(value === 'local' ? '保留这一边' : '采用这一边', () => {
                select.value = value;
                select.dispatchEvent(new Event('change'));
            });
            card.append(heading, text, choose);
            compare.append(card);
        }
        const baseline = document.createElement('details');
        baseline.className = 'ps-conflict-baseline';
        const summary = document.createElement('summary');
        summary.textContent = '查看上次同步的值';
        const baselineValue = document.createElement('pre');
        baselineValue.textContent = baselineText;
        baseline.append(summary, baselineValue);
        const template = conflict.local === MISSING ? conflict.latest : conflict.local;
        const valueType = typeof template;
        const custom = document.createElement(valueType === 'boolean' ? 'select' : valueType === 'number' ? 'input' : 'textarea');
        custom.className = `ps-conflict-custom${valueType === 'string' ? ' ps-conflict-text' : ''}`;
        custom.dataset.valueType = ['string', 'number', 'boolean'].includes(valueType) ? valueType : 'json';
        custom.setAttribute('aria-label', `${path.textContent}的自定义结果`);
        if (valueType === 'number') { custom.type = 'number'; custom.step = 'any'; }
        if (valueType === 'boolean') {
            for (const [value, name] of [['true', '开启'], ['false', '关闭']]) {
                const option = document.createElement('option');
                option.value = value; option.textContent = name; custom.append(option);
            }
        }
        custom.hidden = true;
        custom.value = custom.dataset.valueType === 'json' ? JSON.stringify(template === MISSING ? null : template, null, 2) : String(template);
        select.addEventListener('change', () => {
            custom.hidden = select.value !== 'custom';
            for (const card of compare.children) card.classList.toggle('ps-conflict-chosen', card.dataset.choice === select.value);
        });
        row.append(path, compare, baseline, select, custom);
        body.append(row);
        controls.push({ conflict, select, custom });
    }

    footer.append(
        makeButton('暂不处理', close),
        makeButton('完成同步', async () => {
            try {
                let resolved = merged;
                for (const { conflict, select, custom } of controls) {
                    if (!select.value) throw new Error('请为每一项冲突选择处理方式');
                    let value;
                    if (select.value === 'local') value = conflict.local;
                    else if (select.value === 'latest') value = conflict.latest;
                    else if (select.value === 'delete') value = MISSING;
                    else if (custom.dataset.valueType === 'string') value = custom.value;
                    else if (custom.dataset.valueType === 'boolean') value = custom.value === 'true';
                    else if (custom.dataset.valueType === 'number') {
                        value = Number(custom.value);
                        if (!custom.value.trim() || !Number.isFinite(value)) throw new Error('自定义数值无效');
                    } else value = JSON.parse(custom.value);
                    resolved = setAtPath(resolved, conflict.path, value);
                }
                const data = readCardData(characterId);
                const target = findBoundPreset(data, entry.name);
                if (!target) throw new Error('这个预设已从角色卡解绑');
                target.base = latest;
                target.value = resolved;
                await persist(data, characterId);
                close();
                if (data.activeName === entry.name && activeCharacterId() === characterId) await applyPreset(entry.name, characterId);
                toastr.success(`「${entry.name}」已同步`);
            } catch (error) {
                toastr.error(`无法完成同步：${error.message}`);
            }
        }, 'ps-primary'),
    );
}

function pendingRuntimePromptGroups(entry, data) {
    if (data.activeName !== entry.name || getManager()?.getSelectedPresetName?.() !== sourcePresetName(entry)) return null;
    if (typeof chatCompletion.getChatCompletionPreset !== 'function') return null;
    const current = chatCompletion.getChatCompletionPreset();
    // Import group metadata only for prompts that exist in this copy.
    const runtime = readPromptGroups({ ...current, prompts: entry.value.prompts });
    const saved = readPromptGroups(entry.value);
    const meaningful = state => state ? {
        groups: state.groups.map(({ collapsed, ...group }) => group),
        prompts: state.prompts,
    } : { groups: [], prompts: {} };
    return runtime && !equal(meaningful(runtime), meaningful(saved)) ? runtime : null;
}

function choosePendingPromptGroups(entry, state) {
    return new Promise(resolve => {
        const { backdrop, body, footer, close } = createDialog(
            '检测到未保存的柏宝箱分组',
            `当前柏宝箱里的分组与「${entry.name}」副本不同。可单独保存这些分组到当前角色副本，或继续检查酒馆已保存的原预设。保存分组不会自动保存提示词正文。`,
        );
        const names = document.createElement('p');
        names.className = 'ps-editor-hint';
        names.textContent = `当前分组：${state.groups.map(group => group.name).join('、') || '无分组'}`;
        body.append(names);
        const finish = choice => { close(); resolve(choice); };
        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) finish('cancel');
        });
        footer.append(
            makeButton('取消', () => finish('cancel')),
            makeButton('仅同步原预设', () => finish('source')),
            makeButton('保存分组到副本', () => finish('copy'), 'ps-primary'),
        );
    });
}

async function syncPreset(entry) {
    const characterId = activeCharacterId();
    const initialData = readCardData(characterId);
    const initialEntry = findBoundPreset(initialData, entry.name);
    if (!initialEntry) return;
    entry = initialEntry;
    const pendingGroups = pendingRuntimePromptGroups(initialEntry, initialData);
    if (pendingGroups) {
        const choice = await choosePendingPromptGroups(initialEntry, pendingGroups);
        if (choice === 'cancel' || activeCharacterId() !== characterId) return;
        if (choice === 'copy') {
            const data = readCardData(characterId);
            const target = findBoundPreset(data, entry.name);
            if (!target) return;
            const value = clone(target.value);
            writePromptGroups(value, pendingGroups);
            target.value = value;
            await persist(data, characterId);
            toastr.success('已将柏宝箱分组保存到当前角色副本');
            return;
        }
    }
    const latest = getLatestPreset(sourcePresetName(entry));
    if (!latest) {
        toastr.warning(`酒馆中找不到原预设「${sourcePresetName(entry)}」；请确认预设未被删除或改名`);
        return;
    }
    if (equal(entry.base, latest)) {
        toastr.info(`已检查「${sourcePresetName(entry)}」：酒馆当前保存的预设与同步基线一致。若刚编辑过，请先在酒馆保存该预设，再检查更新。`);
        scheduleRender();
        return;
    }

    const conflicts = [];
    const merged = threeWayMerge(entry.base, entry.value, latest, [], conflicts);
    if (conflicts.length) {
        openConflictResolver(entry, latest, merged, conflicts);
        return;
    }

    const data = readCardData(characterId);
    const target = findBoundPreset(data, entry.name);
    if (!target) return;
    target.base = latest;
    target.value = merged;
    await persist(data, characterId);
    if (data.activeName === entry.name) await applyPreset(entry.name, characterId);
    toastr.success(`「${entry.name}」已同步，无冲突`);
}

async function bindPreset(name) {
    const latest = getLatestPreset(name);
    if (!latest) {
        toastr.error(`无法读取预设「${name}」`);
        return;
    }
    const characterId = activeCharacterId();
    const data = readCardData(characterId);
    if (findBoundPreset(data, name)) {
        toastr.info(`「${name}」已经绑定`);
        return;
    }
    data.presets.push({ name, sourceName: name, note: '', base: clone(latest), value: clone(latest) });
    const shouldActivate = !data.activeName;
    if (shouldActivate) data.activeName = name;
    await persist(data, characterId);
    if (shouldActivate) await applyPreset(name, characterId);
    scheduleRender();
    toastr.success(`已为当前角色卡绑定「${name}」`);
}

async function unbindPreset(name) {
    const characterId = activeCharacterId();
    if (!window.confirm(`解绑「${name}」会删除这张角色卡为它保存的专属版本。继续吗？`)) return;
    if (characterId === null || characterId === undefined) return;
    const data = readCardData(characterId);
    data.presets = data.presets.filter(item => item.name !== name);
    if (data.activeName === name) data.activeName = data.presets[0]?.name ?? '';
    await persist(data, characterId);
    if (data.activeName) await applyPreset(data.activeName, characterId);
}

function copyPreset(entry) {
    const characterId = activeCharacterId();
    const { body, footer, close } = createDialog(`复制「${entry.name}」副本`, '副本保留相同的酒馆原预设作为同步基线，可以使用不同的条目内容和备注。');
    const data = readCardData(characterId);
    const names = new Set(data.presets.map(item => item.name));
    const rootName = `${entry.name} 副本`;
    let candidate = rootName;
    let suffix = 2;
    while (names.has(candidate)) candidate = `${rootName} ${suffix++}`;

    const nameLabel = document.createElement('label');
    nameLabel.className = 'ps-copy-field';
    nameLabel.textContent = '副本名称';
    const nameInput = document.createElement('input');
    nameInput.className = 'text_pole';
    nameInput.value = candidate;
    nameLabel.append(nameInput);
    const noteLabel = document.createElement('label');
    noteLabel.className = 'ps-copy-field';
    noteLabel.textContent = '备注（可选）';
    const noteInput = document.createElement('textarea');
    noteInput.className = 'text_pole';
    noteInput.value = entry.note || '';
    noteInput.rows = 3;
    noteLabel.append(noteInput);
    body.append(nameLabel, noteLabel);
    footer.append(
        makeButton('取消', close),
        makeButton('创建副本', async () => {
            const name = nameInput.value.trim();
            if (!name) return toastr.warning('请输入副本名称');
            if (data.presets.some(item => item.name === name)) return toastr.warning('这个副本名称已存在');
            data.presets.push({
                name,
                sourceName: sourcePresetName(entry),
                note: noteInput.value.trim(),
                base: clone(entry.base),
                value: clone(entry.value),
            });
            await persist(data, characterId);
            close();
            toastr.success(`已创建「${name}」副本`);
        }, 'ps-primary'),
    );
    nameInput.focus();
    nameInput.select();
}

function editPresetNote(entry) {
    const characterId = activeCharacterId();
    const { body, footer, close } = createDialog(`编辑「${entry.name}」备注`, '备注只保存在当前角色卡这个副本上。');
    const noteInput = document.createElement('textarea');
    noteInput.className = 'text_pole';
    noteInput.value = entry.note || '';
    noteInput.rows = 4;
    body.append(noteInput);
    footer.append(
        makeButton('取消', close),
        makeButton('保存备注', async () => {
            const data = readCardData(characterId);
            const target = findBoundPreset(data, entry.name);
            if (!target) return toastr.warning('这个副本已从角色卡解绑');
            target.note = noteInput.value.trim();
            await persist(data, characterId);
            close();
            toastr.success(`已保存「${entry.name}」备注`);
        }, 'ps-primary'),
    );
    noteInput.focus();
}

function openAppearanceDialog(setLauncherImageFromFile) {
    const settings = getUiSettings();
    const { body, footer, close } = createDialog('预设切换器设置', '设置悬浮球大小、图标、列表显示模式，以及切换预设时是否保留当前 API 设置。');
    const showLauncher = document.createElement('input');
    showLauncher.type = 'checkbox';
    showLauncher.checked = settings.launcherVisible;
    const showLauncherLabel = document.createElement('label');
    showLauncherLabel.className = 'ps-settings-checkbox';
    showLauncherLabel.append(showLauncher, document.createTextNode('显示悬浮球'));
    const followLauncher = document.createElement('input');
    followLauncher.type = 'checkbox';
    followLauncher.checked = settings.panelFollowsLauncher;
    const followLauncherLabel = document.createElement('label');
    followLauncherLabel.className = 'ps-settings-checkbox';
    followLauncherLabel.append(followLauncher, document.createTextNode('界面跟随悬浮球移动'));
    const launcherOptions = document.createElement('div');
    launcherOptions.className = 'ps-launcher-options';
    launcherOptions.append(showLauncherLabel, followLauncherLabel);
    body.append(launcherOptions);
    const imageUrl = document.createElement('input');
    imageUrl.className = 'text_pole';
    imageUrl.type = 'url';
    imageUrl.placeholder = `默认使用当前酒馆图标：${new URL('/favicon.ico', window.location.origin).href}`;
    imageUrl.value = settings.launcherImage.startsWith('data:') ? '' : settings.launcherImage;
    imageUrl.setAttribute('aria-label', '图标图片 URL');
    const imageFile = document.createElement('input');
    imageFile.className = 'text_pole ps-settings-file';
    imageFile.type = 'file';
    imageFile.accept = 'image/*';
    imageFile.setAttribute('aria-label', '选择本地图片');
    const mode = document.createElement('select');
    mode.className = 'text_pole';
    mode.setAttribute('aria-label', '预设切换器显示模式');
    for (const [value, label] of [['full', '完整'], ['quick', '快速']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        mode.append(option);
    }
    mode.value = settings.viewMode;
    const preserve = document.createElement('input');
    preserve.type = 'checkbox';
    preserve.checked = settings.preserveApiSettings;
    preserve.setAttribute('aria-label', '切换预设时保留当前 API 设置');

    const settingsField = (label, control) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'ps-settings-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        wrapper.append(caption, control);
        return wrapper;
    };

    const sizeControls = document.createElement('div');
    sizeControls.className = 'ps-launcher-size-controls';
    const sizeRange = document.createElement('input');
    sizeRange.type = 'range';
    sizeRange.min = '24';
    sizeRange.max = '80';
    sizeRange.step = '1';
    sizeRange.value = String(settings.launcherSize);
    sizeRange.setAttribute('aria-label', '悬浮球直径');
    const sizeNumber = document.createElement('input');
    sizeNumber.className = 'text_pole ps-launcher-size-number';
    sizeNumber.type = 'number';
    sizeNumber.min = '24';
    sizeNumber.max = '80';
    sizeNumber.step = '1';
    sizeNumber.value = String(settings.launcherSize);
    sizeNumber.setAttribute('aria-label', '悬浮球直径，单位像素');
    const sizeUnit = document.createElement('span');
    sizeUnit.textContent = 'px';
    sizeControls.append(sizeRange, sizeNumber, sizeUnit);
    const sizePreview = document.createElement('div');
    sizePreview.className = 'ps-launcher-size-preview';
    sizePreview.setAttribute('aria-hidden', 'true');
    const previewFace = document.createElement('span');
    previewFace.className = 'ps-launcher-size-face';
    previewFace.textContent = '预';
    const previewImage = document.createElement('img');
    previewImage.alt = '';
    previewImage.src = settings.launcherImage || new URL('/favicon.ico', window.location.origin).href;
    previewImage.addEventListener('error', () => { previewImage.hidden = true; });
    previewFace.append(previewImage);
    sizePreview.append(previewFace);
    const sizeHint = document.createElement('p');
    sizeHint.className = 'ps-editor-hint';
    const updateSizePreview = size => {
        sizeRange.value = String(size);
        previewFace.style.width = `${size}px`;
        previewFace.style.height = `${size}px`;
        sizeHint.textContent = `球面直径 ${size} px，触控区域 ${Math.max(48, size + 16)} × ${Math.max(48, size + 16)} px。保存后生效，贴边时左右均隐藏半个球面。`;
    };
    const readSize = () => {
        const size = Number(sizeNumber.value);
        return Number.isInteger(size) && size >= 24 && size <= 80 ? size : null;
    };
    sizeRange.addEventListener('input', () => {
        sizeNumber.value = sizeRange.value;
        sizeNumber.setCustomValidity('');
        updateSizePreview(Number(sizeRange.value));
    });
    sizeNumber.addEventListener('input', () => {
        sizeNumber.setCustomValidity('');
        const size = readSize();
        if (size !== null) updateSizePreview(size);
    });
    const resetSize = makeButton(`恢复 ${DEFAULT_LAUNCHER_SIZE} px`, () => {
        sizeNumber.value = String(DEFAULT_LAUNCHER_SIZE);
        sizeNumber.setCustomValidity('');
        updateSizePreview(DEFAULT_LAUNCHER_SIZE);
    }, 'ps-launcher-size-reset');
    updateSizePreview(settings.launcherSize);
    body.append(
        settingsField('悬浮球大小（24–80 px）', sizeControls),
        sizePreview, sizeHint, resetSize,
        settingsField('图标图片 URL', imageUrl),
        settingsField('或选择本地图片', imageFile),
    );
    const note = document.createElement('p');
    note.className = 'ps-editor-hint';
    note.textContent = '也可以把图片拖到悬浮球上。图片保存在当前设备，本地图片限 2 MB。';
    body.append(note, settingsField('显示模式', mode));
    const preserveLabel = document.createElement('label');
    preserveLabel.className = 'ps-settings-checkbox';
    preserveLabel.append(preserve, document.createTextNode('切换预设时保留当前 API 设置'));
    const preserveHint = document.createElement('p');
    preserveHint.className = 'ps-editor-hint';
    preserveHint.textContent = '开启后保留当前 API 来源、模型等连接项，只应用角色副本中的预设内容。';
    body.append(preserveLabel, preserveHint);

    const saveOptions = async imageSource => {
        const size = readSize();
        if (size === null) {
            sizeNumber.setCustomValidity('请输入 24 到 80 的整数');
            sizeNumber.reportValidity();
            throw new Error('悬浮球直径须为 24 到 80 的整数');
        }
        saveUiSettings({
            launcherImage: imageSource,
            launcherVisible: showLauncher.checked,
            panelFollowsLauncher: followLauncher.checked,
            launcherSize: size,
            viewMode: mode.value === 'quick' ? 'quick' : 'full',
            preserveApiSettings: preserve.checked,
        });
        if (!showLauncher.checked) closeSwitcherPanel();
        render();
    };
    footer.append(
        makeButton('取消', close),
        makeButton('恢复默认图标', async () => {
            try {
                await saveOptions('');
                close();
                toastr.success('已恢复默认悬浮球图标');
            } catch (error) {
                toastr.error(error.message);
            }
        }),
        makeButton('保存设置', async () => {
            try {
                if (readSize() === null) {
                    sizeNumber.setCustomValidity('请输入 24 到 80 的整数');
                    sizeNumber.reportValidity();
                    throw new Error('悬浮球直径须为 24 到 80 的整数');
                }
                const file = imageFile.files?.[0];
                let imageSource = getUiSettings().launcherImage;
                if (file) {
                    await setLauncherImageFromFile(file, imageFile);
                    imageSource = getUiSettings().launcherImage;
                } else if (imageUrl.value.trim()) {
                    const parsed = new URL(imageUrl.value.trim(), window.location.href);
                    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('图片 URL 只支持 http 或 https');
                    imageSource = parsed.href;
                }
                await saveOptions(imageSource);
                close();
                toastr.success('已保存预设切换器设置');
            } catch (error) {
                toastr.error(error.message);
            }
        }, 'ps-primary'),
    );
}

function closeSwitcherPanel() {
    if (!root) return;
    switcherPanel.hidden = true;
    centeredPanelRoot.hidden = true;
    root.querySelector('.ps-launcher').setAttribute('aria-expanded', 'false');
}

function createExtensionSettings(openPanel, openSettings) {
    const container = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
    if (!container || document.getElementById('preset-switcher-settings')) return;
    const settings = document.createElement('div');
    settings.id = 'preset-switcher-settings';
    settings.className = 'extension_container';
    settings.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>预设切换器</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div class="ps-launcher-options"><label class="checkbox_label"><input id="preset-switcher-launcher-visible" type="checkbox">显示悬浮球</label><label class="checkbox_label"><input id="preset-switcher-panel-follow" type="checkbox">界面跟随悬浮球移动</label></div><label class="checkbox_label"><input id="preset-switcher-draw-enabled" type="checkbox">开启角色抽卡</label><div class="ps-settings-actions"></div></div></div>';
    launcherVisibilityControl = settings.querySelector('#preset-switcher-launcher-visible');
    launcherVisibilityControl.checked = getUiSettings().launcherVisible;
    launcherVisibilityControl.addEventListener('change', () => {
        saveUiSettings({ launcherVisible: launcherVisibilityControl.checked });
        if (!launcherVisibilityControl.checked) closeSwitcherPanel();
        render();
    });
    panelFollowControl = settings.querySelector('#preset-switcher-panel-follow');
    panelFollowControl.checked = getUiSettings().panelFollowsLauncher;
    panelFollowControl.addEventListener('change', () => {
        saveUiSettings({ panelFollowsLauncher: panelFollowControl.checked });
        render();
    });
    characterDrawControl = settings.querySelector('#preset-switcher-draw-enabled');
    characterDrawControl.checked = getUiSettings().characterDrawEnabled;
    characterDrawControl.addEventListener('change', () => {
        saveUiSettings({ characterDrawEnabled: characterDrawControl.checked });
        characterDraw?.close();
        closeSwitcherPanel();
        render();
    });
    settings.querySelector('.ps-settings-actions').append(makeButton('管理角色预设', openPanel), makeButton('设置', openSettings));
    container.append(settings);
}

function getEntryStatus(entry, availablePresets, latestByName) {
    const sourceName = sourcePresetName(entry);
    if (!availablePresets.has(sourceName)) return '原预设已删除或改名';
    if (!latestByName.has(sourceName)) latestByName.set(sourceName, getLatestPreset(sourceName));
    const latest = latestByName.get(sourceName);
    if (!latest || equal(entry.base, latest)) return '已同步';
    return '有更新可同步';
}

function render() {
    if (!root) return;
    const uiSettings = getUiSettings();
    if (launcherVisibilityControl) launcherVisibilityControl.checked = uiSettings.launcherVisible;
    if (panelFollowControl) panelFollowControl.checked = uiSettings.panelFollowsLauncher;
    if (characterDrawControl) characterDrawControl.checked = uiSettings.characterDrawEnabled;
    const characterId = activeCharacterId();
    const character = characterId === null || characterId === undefined ? null : characters?.[characterId];
    const canUsePresets = Boolean(character) && main_api === 'openai';
    root.hidden = (!canUsePresets && !uiSettings.characterDrawEnabled) || (!uiSettings.launcherVisible && switcherPanel.hidden);
    root.querySelector('.ps-launcher').hidden = !uiSettings.launcherVisible;
    applyLauncherPosition(root, uiSettings);

    if (renderedCharacterId !== characterId) {
        renderedCharacterId = characterId;
        presetPage = 1;
    }

    const data = readCardData(characterId);
    const isOpenAi = canUsePresets && Boolean(getManager());
    const activeEntry = findBoundPreset(data, data.activeName);
    const launcher = root.querySelector('.ps-launcher');
    const image = launcher.querySelector('.ps-launcher-image');
    const label = launcher.querySelector('.ps-launcher-label');
    const customImage = uiSettings.launcherImage;
    const defaultImage = new URL('/favicon.ico', window.location.origin).href;
    const displayedImage = customImage || defaultImage;
    image.onload = () => {
        image.hidden = false;
        label.hidden = true;
    };
    image.onerror = () => {
        image.hidden = true;
        label.hidden = false;
    };
    if (image.dataset.imageSource !== displayedImage) {
        image.dataset.imageSource = displayedImage;
        image.hidden = false;
        label.hidden = true;
        image.src = displayedImage;
    }
    label.textContent = activeEntry?.name?.slice(0, 1) || '预';
    launcher.title = uiSettings.characterDrawEnabled ? '选择预设切换器或角色抽卡' : activeEntry ? `预设切换器：${activeEntry.name}` : '预设切换器';
    launcher.setAttribute('aria-label', uiSettings.characterDrawEnabled ? '选择预设切换器或角色抽卡' : '打开预设切换器');
    launcher.disabled = !uiSettings.characterDrawEnabled && !canUsePresets;

    const panel = switcherPanel;
    if (!canUsePresets) {
        panel.hidden = true;
        centeredPanelRoot.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        return;
    }
    const list = panel.querySelector('.ps-list');
    const message = panel.querySelector('.ps-message');
    const addSelect = panel.querySelector('.ps-add-select');
    const quickMode = uiSettings.viewMode === 'quick';
    panel.classList.toggle('ps-quick-mode', quickMode);
    panel.querySelector('.ps-bind').hidden = quickMode;
    presetPager.element.hidden = quickMode && data.presets.length <= PRESETS_PER_PAGE;
    const previouslySelectedPreset = addSelect.value;
    list.replaceChildren();
    message.textContent = canUsePresets ? `当前角色：${character.name || '未命名角色'}` : '请先打开角色聊天并切换到 OpenAI/聊天补全 API。';

    const availablePresetNames = presetNames();
    const availablePresets = new Set(availablePresetNames);
    const latestByName = new Map();
    const boundNames = new Set(data.presets.map(sourcePresetName));
    addSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择酒馆预设以绑定…';
    addSelect.append(placeholder);
    for (const name of availablePresetNames) {
        if (boundNames.has(name)) continue;
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        addSelect.append(option);
    }
    if ([...addSelect.options].some(option => option.value === previouslySelectedPreset)) {
        addSelect.value = previouslySelectedPreset;
    }
    addSelect.disabled = !isOpenAi || addSelect.options.length < 2;

    const presetPageCount = Math.max(1, Math.ceil(data.presets.length / PRESETS_PER_PAGE));
    presetPage = Math.min(presetPageCount, Math.max(1, presetPage));
    presetPager?.update(presetPage, presetPageCount, data.presets.length);

    if (!data.presets.length) {
        const empty = document.createElement('p');
        empty.className = 'ps-empty';
        empty.textContent = '这张角色卡还没有绑定预设。';
        list.append(empty);
    }

    const presetStart = (presetPage - 1) * PRESETS_PER_PAGE;
    for (const entry of data.presets.slice(presetStart, presetStart + PRESETS_PER_PAGE)) {
        const row = document.createElement('article');
        row.className = 'ps-entry';
        const heading = document.createElement('div');
        heading.className = 'ps-entry-heading';
        const title = document.createElement('strong');
        title.className = 'ps-entry-title';
        title.textContent = entry.note || sourcePresetName(entry);
        const status = document.createElement('span');
        status.className = 'ps-status';
        status.textContent = getEntryStatus(entry, availablePresets, latestByName);
        status.hidden = quickMode;
        heading.append(title, status);
        row.append(heading);
        const subtitleText = quickMode
            ? (entry.note ? sourcePresetName(entry) : '')
            : entry.note ? sourcePresetName(entry) : entry.name !== sourcePresetName(entry) ? `副本：${entry.name}` : '';
        if (subtitleText) {
            const subtitle = document.createElement('p');
            subtitle.className = 'ps-entry-subtitle';
            subtitle.textContent = subtitleText;
            row.append(subtitle);
        }
        const actions = document.createElement('div');
        actions.className = 'ps-actions';
        const select = makeButton(data.activeName === entry.name ? '当前使用中' : '切换到此预设', () => applyPreset(entry.name), data.activeName === entry.name ? 'ps-selected' : '');
        select.disabled = !isOpenAi || applyingCharacterId !== null || !availablePresets.has(sourcePresetName(entry));
        actions.append(select);
        if (!quickMode) {
            actions.append(makeButton('编辑副本', () => openEditor(entry)), makeButton('复制副本', () => copyPreset(entry)), makeButton('备注', () => editPresetNote(entry)));
            const sync = makeButton('检查 / 同步更新', () => syncPreset(entry));
            sync.disabled = !availablePresets.has(sourcePresetName(entry));
            actions.append(sync, makeButton('解绑', () => unbindPreset(entry.name), 'ps-danger'));
        } else {
            row.classList.add('ps-entry-quick');
        }
        row.append(actions);
        list.append(row);
    }
    keepPanelInViewport(root);
}

function createUi() {
    if (document.getElementById(ROOT_ID)) return document.getElementById(ROOT_ID);
    const element = document.createElement('div');
    element.id = ROOT_ID;
    element.hidden = true;
    element.innerHTML = `
        <button type="button" class="ps-launcher" aria-label="打开预设切换器" aria-expanded="false"><span class="ps-launcher-face"><img class="ps-launcher-image" alt="" draggable="false" hidden><span class="ps-launcher-label">预</span></span></button>
        <section class="ps-panel" hidden>
            <header class="ps-header"><strong>预设切换器</strong><span class="ps-header-actions"><button type="button" class="ps-appearance-toggle ps-icon-button" aria-label="外观设置" title="外观设置"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path><circle cx="9" cy="6" r="2" fill="var(--SmartThemeBlurTintColor, #24242b)" stroke="currentColor" stroke-width="1.8"></circle><circle cx="15" cy="12" r="2" fill="var(--SmartThemeBlurTintColor, #24242b)" stroke="currentColor" stroke-width="1.8"></circle><circle cx="8" cy="18" r="2" fill="var(--SmartThemeBlurTintColor, #24242b)" stroke="currentColor" stroke-width="1.8"></circle></svg></button><button type="button" class="ps-close" aria-label="关闭">×</button></span></header>
            <p class="ps-message"></p>
            <div class="ps-list"></div>
            <footer class="ps-bind"><select class="text_pole ps-add-select" aria-label="选择要绑定的预设"></select><button type="button" class="menu_button ps-add">绑定</button></footer>
        </section>`;
    presetPager = createPager('ps-preset-pager', '角色预设列表', page => {
        presetPage = page;
        render();
    });
    element.querySelector('.ps-list').after(presetPager.element);
    // SillyTavern gives <body> a fixed full-viewport box while <html> can have
    // zero height. Anchor the floating UI to that body box instead.
    document.body.append(element);
    const launcher = element.querySelector('.ps-launcher');
    const panel = element.querySelector('.ps-panel');
    switcherPanel = panel;
    // Keep a centered panel outside any launcher collector's transforms or clipping.
    centeredPanelRoot = document.createElement('div');
    centeredPanelRoot.id = PANEL_ROOT_ID;
    centeredPanelRoot.className = 'ps-panel-centered';
    centeredPanelRoot.hidden = true;
    document.body.append(centeredPanelRoot);
    const openPresetPanel = () => {
        if (activeCharacterId() === null || activeCharacterId() === undefined || main_api !== 'openai') {
            toastr.info('请先打开角色卡聊天并切换到 OpenAI / 聊天补全');
            return;
        }
        panel.hidden = false;
        launcher.setAttribute('aria-expanded', 'true');
        const extensionDrawer = document.getElementById('rm_extensions_block');
        if (extensionDrawer?.classList.contains('openDrawer')) extensionDrawer.closest('.drawer')?.querySelector('.drawer-toggle')?.click();
        render();
    };
    characterDraw = createCharacterDraw({
        host: tavernHost, getSettings: getUiSettings, saveSettings: saveUiSettings, createDialog, makeButton,
        openPresets: openPresetPanel,
        canOpenPresets: () => activeCharacterId() !== null && activeCharacterId() !== undefined && main_api === 'openai',
        getPresetPool: () => {
            const characterId = activeCharacterId();
            const settings = getUiSettings();
            if (settings.drawCurrentCharacterPresetsOnly && characterId !== null && characterId !== undefined && characters?.[characterId]) {
                return {
                    scope: 'character',
                    entries: readCardData(characterId).presets.filter(entry => presetNames().includes(sourcePresetName(entry))),
                };
            }
            return { scope: 'global', entries: presetNames().map(name => ({ name, sourceName: name })) };
        },
        canApplyPreset: () => main_api === 'openai' && Boolean(getManager()),
        applyPreset: (entry, scope) => scope === 'character'
            ? applyPreset(entry.name, activeCharacterId())
            : applyGlobalPreset(entry.name),
    });
    let pointerStart = null;
    let dragged = false;
    let suppressClick = false;

    const setLauncherImageFromFile = async (file, fileInput = null) => {
        if (!file?.type.startsWith('image/')) throw new Error('这不是图片文件，请拖入图片（例如 PNG、JPG、WebP 或 GIF）');
        if (file.size > 2 * 1024 * 1024) throw new Error('本地图片不能超过 2 MB');
        const imageSource = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('读取本地图片失败'));
            reader.readAsDataURL(file);
        });
        saveUiSettings({ launcherImage: imageSource });
        render();
        if (fileInput) fileInput.value = '';
        toastr.success('已更新悬浮球图片');
    };

    // SillyTavern's global drop handler also sees files dropped on the launcher.
    // Intercept in capture phase so unsupported files never reach that handler.
    const isFileDropOnLauncher = event => event.composedPath().includes(launcher)
        && Array.from(event.dataTransfer?.types ?? []).includes('Files');
    for (const eventName of ['dragenter', 'dragover', 'drop']) {
        document.addEventListener(eventName, event => {
            if (!isFileDropOnLauncher(event)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (eventName === 'dragover') event.dataTransfer.dropEffect = 'copy';
            if (eventName === 'drop') {
                const file = event.dataTransfer.files?.[0];
                setLauncherImageFromFile(file).catch(error => toastr.error(error.message));
            }
        }, true);
    }

    launcher.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const rect = launcher.getBoundingClientRect();
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        dragged = false;
        launcher.setPointerCapture(event.pointerId);
    });
    launcher.addEventListener('pointermove', event => {
        if (!pointerStart || pointerStart.id !== event.pointerId) return;
        if (!dragged && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 6) return;
        dragged = true;
        const rect = launcher.getBoundingClientRect();
        const left = Math.max(-rect.width / 2, Math.min(window.innerWidth - rect.width / 2, event.clientX - pointerStart.offsetX));
        const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - pointerStart.offsetY));
        element.style.left = `${left}px`;
        element.style.right = 'auto';
        element.style.top = `${top}px`;
        element.classList.remove('ps-left-docked', 'ps-right-docked', 'ps-panel-below');
    });
    const finishDrag = event => {
        if (!pointerStart || pointerStart.id !== event.pointerId) return;
        if (dragged) {
            const rect = launcher.getBoundingClientRect();
            const edgeThreshold = Math.max(32, rect.width * .75);
            const leftGap = rect.left;
            const rightGap = window.innerWidth - rect.right;
            const dockSide = leftGap <= edgeThreshold ? 'left' : rightGap <= edgeThreshold ? 'right' : 'free';
            const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
            const maxLeft = Math.max(1, window.innerWidth - rect.width);
            const top = Math.max(8, Math.min(maxTop, event.clientY - pointerStart.offsetY));
            const leftRatio = Math.min(1, Math.max(0, rect.left / maxLeft));
            saveUiSettings({ dockSide, xRatio: leftRatio, topRatio: top / maxTop });
            applyLauncherPosition(element);
            suppressClick = true;
            window.setTimeout(() => { suppressClick = false; }, 0);
        }
        pointerStart = null;
    };
    launcher.addEventListener('pointerup', finishDrag);
    launcher.addEventListener('pointercancel', finishDrag);
    launcher.addEventListener('click', () => {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        if (getUiSettings().characterDrawEnabled) {
            closeSwitcherPanel();
            characterDraw.toggleChoice();
            render();
            return;
        }
        panel.hidden = !panel.hidden;
        launcher.setAttribute('aria-expanded', String(!panel.hidden));
        render();
    });
    panel.querySelector('.ps-close').addEventListener('click', () => {
        closeSwitcherPanel();
        render();
    });
    panel.querySelector('.ps-appearance-toggle').addEventListener('click', () => {
        openAppearanceDialog(setLauncherImageFromFile);
    });
    window.addEventListener('resize', () => applyLauncherPosition(element));
    panel.querySelector('.ps-add').addEventListener('click', async () => {
        const select = panel.querySelector('.ps-add-select');
        if (select.value) await bindPreset(select.value);
    });
    createExtensionSettings(openPresetPanel, () => openAppearanceDialog(setLauncherImageFromFile));
    return element;
}

async function onChatChanged() {
    scheduleRender();
    const characterId = activeCharacterId();
    if (characterId === null || characterId === undefined || main_api !== 'openai') return;
    const data = readCardData(characterId);
    const targetName = findBoundPreset(data, data.activeName)?.name || data.presets[0]?.name;
    if (targetName) await applyPreset(targetName, characterId);
}

export function init() {
    if (initialized) return;
    root = createUi();
    // Inject the character copy before BaiBai's early render and group cache.
    eventSource.makeFirst(event_types.OAI_PRESET_CHANGED_BEFORE, ({ preset, presetName, settingsToUpdate }) => {
        const currentId = activeCharacterId();
        const characterId = applyingCharacterId === currentId ? applyingCharacterId : currentId;
        if (characterId === null || characterId === undefined || !isObject(preset)) return;
        const data = readCardData(characterId);
        const isApplyingSelectedCopy = applyingCharacterId === characterId && applyingEntryName;
        const activeEntry = findBoundPreset(data, data.activeName);
        const entry = isApplyingSelectedCopy
            ? findBoundPreset(data, applyingEntryName)
            : activeEntry && sourcePresetName(activeEntry) === presetName
                ? activeEntry
                : data.presets.find(item => sourcePresetName(item) === presetName);
        if (!entry || sourcePresetName(entry) !== presetName) return;
        for (const key of Object.keys(preset)) delete preset[key];
        Object.assign(preset, clone(entry.value));
        if (applyingPreserveApiSettings && applyingCharacterId === characterId) {
            for (const [key, definition] of Object.entries(settingsToUpdate ?? {})) {
                if (definition?.[3] === true || key === 'chat_completion_source') delete preset[key];
            }
            // Older SillyTavern builds may not pass this map to the event.
            delete preset.chat_completion_source;
        }
    });
    eventSource.makeLast(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.APP_READY, () => {
        scheduleRender();
        if (activeCharacterId() !== null && activeCharacterId() !== undefined) onChatChanged();
    });
    document.addEventListener('visibilitychange', scheduleRender);
    initialized = true;
    scheduleRender();
}

// ST versions without manifest activation hooks load the module but never call init.
// Newer hosts may use both entry points; the guard keeps UI and listeners unique.
jQuery(init);

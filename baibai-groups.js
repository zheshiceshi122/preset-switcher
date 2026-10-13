// BaiBai's portable preset metadata; no dependency on its installation path.
export function comparableExtensions(extensions, counterpart) {
    const value = structuredClone(extensions ?? {});
    const toolkit = value.baibaiToolkit;
    if (!toolkit || typeof toolkit !== 'object') return value;
    for (const [key, members] of [['presetPromptGroups', 'prompts'], ['regexGroups', 'scripts']]) {
        const state = toolkit[key];
        if (counterpart?.baibaiToolkit?.[key] !== undefined || !state || state.version !== 1) continue;
        if (Array.isArray(state.groups) && state.groups.length === 0 && state[members] && typeof state[members] === 'object' && Object.keys(state[members]).length === 0) {
            // BaiBai materializes empty group metadata during rendering. It does
            // not change which prompts or regex scripts participate in generation.
            delete toolkit[key];
        }
    }
    if (Object.keys(toolkit).length === 0) delete value.baibaiToolkit;
    return value;
}

export function readPromptGroups(value) {
    const raw = value?.extensions?.baibaiToolkit?.presetPromptGroups;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const validPrompts = new Set((Array.isArray(value.prompts) ? value.prompts : []).map(prompt => prompt?.identifier).filter(Boolean));
    const seen = new Set();
    const groups = (Array.isArray(raw.groups) ? raw.groups : [])
        .filter(group => group && group.id)
        .map((group, index) => ({ ...structuredClone(group), id: String(group.id), name: String(group.name || '未命名分组'), order: Number.isFinite(Number(group.order)) ? Number(group.order) : index, collapsed: Boolean(group.collapsed), enabled: group.enabled !== false }))
        .sort((a, b) => a.order - b.order)
        .filter(group => {
            if (seen.has(group.id)) return false;
            seen.add(group.id);
            return true;
        });
    const prompts = {};
    for (const [identifier, meta] of Object.entries(raw.prompts ?? {})) {
        const groupId = String(meta?.groupId ?? '');
        if (validPrompts.has(identifier) && seen.has(groupId)) prompts[identifier] = { ...structuredClone(meta), groupId };
    }
    const metadata = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'groups' && key !== 'prompts'));
    return { ...structuredClone(metadata), version: raw.version ?? 1, groups, prompts };
}

export function writePromptGroups(value, state) {
    if (!state) return;
    value.extensions ??= {};
    value.extensions.baibaiToolkit ??= {};
    value.extensions.baibaiToolkit.presetPromptGroups = structuredClone(state);
}

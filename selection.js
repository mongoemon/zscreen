'use strict';

// Selection of one or many objects. A single object lives in state.selectedId / selectedAnnId (as before);
// two or more live in state.group and leave those two null, so single-object code stays untouched.
(() => {
  const { state: S } = App;
  const EMPTY = Object.freeze({ itemIds: [], annIds: [] });

  const groupSize = () => S.group.itemIds.length + S.group.annIds.length;
  const inGroup = (kind, id) => (kind === 'item' ? S.group.itemIds : S.group.annIds).includes(id);

  function currentSelection() {
    if (groupSize() > 0) return S.group;
    return {
      itemIds: S.selectedId === null ? [] : [S.selectedId],
      annIds: S.selectedAnnId === null ? [] : [S.selectedAnnId],
    };
  }

  /** Replaces the selection; 0 ids clears it, 1 id is a normal single selection, more make a group. */
  function setSelection({ itemIds, annIds }) {
    const total = itemIds.length + annIds.length;
    S.group = EMPTY;
    S.selectedId = null;
    S.selectedAnnId = null;
    if (total === 1 && itemIds.length === 1) {
      S.selectedId = itemIds[0];
    } else if (total === 1) {
      App.selectAnnotation(S.annotations.find((a) => a.id === annIds[0]) || null);
    } else if (total > 1) {
      S.group = { itemIds: [...itemIds], annIds: [...annIds] };
    }
    App.updateControls();
  }

  const clearSelection = () => setSelection(EMPTY);

  /** Ctrl/Cmd+click: add the object to the selection, or take it out when it is already selected. */
  function toggleInSelection(kind, id) {
    const key = kind === 'item' ? 'itemIds' : 'annIds';
    const current = currentSelection();
    setSelection({ ...current, [key]: Scene.toggleId(current[key], id) });
  }

  /** Drops ids whose object no longer exists (after undo, delete, ...). */
  function pruneSelection() {
    const { itemIds, annIds } = currentSelection();
    setSelection({
      itemIds: itemIds.filter((id) => S.items.some((it) => it.id === id)),
      annIds: annIds.filter((id) => S.annotations.some((a) => a.id === id)),
    });
  }

  Object.assign(App, {
    groupSize, inGroup, currentSelection, setSelection, clearSelection, toggleInSelection, pruneSelection,
  });
})();

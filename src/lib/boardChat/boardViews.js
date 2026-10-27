// src/lib/boardChat/boardViews.js
//
// Board Chat filter views. Each filter Claude sets is saved as a view the
// user can switch on and off. Pure: every function returns the next store and
// `apply` — the board filters to set, or null to leave them alone.
//
// store: { views: [{ id, label, filters }], activeId, before }
// filters: { orgFilter, titleSearch, columnFilters, scorecardFilter, aiFilter: { itemIds } | null }
// before: the user's own filters from just before a view was turned on, so
// turning the view off puts them back.

export const EMPTY_VIEWS = { views: [], activeId: null, before: null };

export function addView(store, view, current) {
  return {
    store: {
      views: [...store.views, view],
      activeId: view.id,
      before: store.activeId ? store.before : current,
    },
    apply: view.filters,
  };
}

export function toggleView(store, id, current) {
  if (store.activeId === id) {
    return { store: { ...store, activeId: null, before: null }, apply: store.before };
  }
  const view = store.views.find((v) => v.id === id);
  return {
    store: { ...store, activeId: id, before: store.activeId ? store.before : current },
    apply: view.filters,
  };
}

export function removeView(store, id) {
  const views = store.views.filter((v) => v.id !== id);
  if (store.activeId !== id) return { store: { ...store, views }, apply: null };
  return { store: { views, activeId: null, before: null }, apply: store.before };
}

export function resetViews(store) {
  return { ...store, activeId: null, before: null };
}

export function activeView(store) {
  return store.views.find((v) => v.id === store.activeId) || null;
}

// A view's AI item list as the board matcher wants it: { label, ids: Set }.
export function aiFilterOfView(view) {
  const ai = view?.filters.aiFilter;
  return ai ? { label: view.label, ids: new Set(ai.itemIds) } : null;
}

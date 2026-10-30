// src/lib/boardChat/__tests__/boardViews.test.js
import { describe, it, expect } from "vitest";
import { EMPTY_VIEWS, activeView, addView, aiFilterOfView, isEdited, removeView, removeViews, resetViews, toggleView } from "../boardViews.js";

const own = { orgFilter: "vistamar", titleSearch: "", columnFilters: {}, scorecardFilter: null };
const fA = { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: { itemIds: ["a1", "a2"] } };
const fB = { orgFilter: "unio", titleSearch: "", columnFilters: { statusId: [2] }, scorecardFilter: null, aiFilter: null };

describe("boardViews", () => {
  it("addView saves the view, turns it on and remembers the filters from before", () => {
    const { store, apply } = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own);
    expect(store.views).toEqual([{ id: "v1", label: "A", filters: fA }]);
    expect(store.activeId).toBe("v1");
    expect(store.before).toEqual(own);
    expect(apply).toEqual(fA);
  });

  it("a second view keeps the original before-filters", () => {
    const s1 = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    const { store } = addView(s1, { id: "v2", label: "B", filters: fB }, fA);
    expect(store.views.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(store.activeId).toBe("v2");
    expect(store.before).toEqual(own);
  });

  it("toggle switches between views and off restores the before-filters", () => {
    let s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    s = addView(s, { id: "v2", label: "B", filters: fB }, fA).store;

    let r = toggleView(s, "v1", fB);
    expect(r.store.activeId).toBe("v1");
    expect(r.apply).toEqual(fA);

    r = toggleView(r.store, "v1", fA);
    expect(r.store.activeId).toBeNull();
    expect(r.store.before).toBeNull();
    expect(r.apply).toEqual(own);
  });

  it("toggling on from no active view captures the current filters as before", () => {
    let s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    s = toggleView(s, "v1", fA).store;
    const mine = { ...own, titleSearch: "seo" };
    const r = toggleView(s, "v1", mine);
    expect(r.store.before).toEqual(mine);
    expect(r.apply).toEqual(fA);
  });

  it("removing the active view restores the before-filters; removing another applies nothing", () => {
    let s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    s = addView(s, { id: "v2", label: "B", filters: fB }, fA).store;

    let r = removeView(s, "v1");
    expect(r.store.views.map((v) => v.id)).toEqual(["v2"]);
    expect(r.store.activeId).toBe("v2");
    expect(r.apply).toBeNull();

    r = removeView(r.store, "v2");
    expect(r.store).toEqual(EMPTY_VIEWS);
    expect(r.apply).toEqual(own);
  });

  it("removeViews removes several at once (a deleted chat's views) and restores the before-filters", () => {
    let s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    s = addView(s, { id: "v2", label: "B", filters: fB }, fA).store;
    s = addView(s, { id: "v3", label: "C", filters: fB }, fB).store;
    const r = removeViews(s, ["v1", "v3"]);
    expect(r.store.views.map((v) => v.id)).toEqual(["v2"]);
    expect(r.store.activeId).toBeNull();
    expect(r.apply).toEqual(own);
    expect(removeViews(s, []).apply).toBeNull();
  });

  it("resetViews turns every view off without deleting any", () => {
    const s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    expect(resetViews(s)).toEqual({ views: s.views, activeId: null, before: null });
  });

  it("aiFilterOfView gives the active view's label and item ids as a Set", () => {
    const s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    expect(aiFilterOfView(activeView(s))).toEqual({ label: "A", ids: new Set(["a1", "a2"]) });
    expect(aiFilterOfView(activeView(resetViews(s)))).toBeNull();
    const sB = addView(EMPTY_VIEWS, { id: "v2", label: "B", filters: fB }, own).store;
    expect(aiFilterOfView(activeView(sB))).toBeNull();
  });

  it("isEdited is false while the board matches the view, ignoring key order and empty values", () => {
    const view = { id: "v2", label: "B", filters: { ...fB, columnFilters: { statusId: [2], priorityId: [1] } } };
    expect(isEdited(view, { orgFilter: "unio", titleSearch: "", columnFilters: { priorityId: [1], statusId: [2], tagIds: [] }, scorecardFilter: null })).toBe(false);
    expect(isEdited(view, { orgFilter: "unio", titleSearch: undefined, columnFilters: { priorityId: [1], statusId: [2] }, scorecardFilter: undefined })).toBe(false);
    const two = { id: "v3", label: "C", filters: { ...fB, columnFilters: { statusId: [2, 3] } } };
    expect(isEdited(two, { ...fB, columnFilters: { statusId: [3, 2] } })).toBe(false);
  });

  it("isEdited is true once the user changes any of the view's filters", () => {
    const view = { id: "v2", label: "B", filters: fB };
    expect(isEdited(view, { ...fB, titleSearch: "seo" })).toBe(true);
    expect(isEdited(view, { ...fB, columnFilters: { statusId: [2, 3] } })).toBe(true);
    expect(isEdited(view, { ...fB, orgFilter: "all" })).toBe(true);
    expect(isEdited(view, { ...fB, scorecardFilter: "blocked" })).toBe(true);
  });

  it("clicking an edited active view puts its saved filters back and keeps it on", () => {
    const s = addView(EMPTY_VIEWS, { id: "v1", label: "A", filters: fA }, own).store;
    const r = toggleView(s, "v1", { ...fA, titleSearch: "seo" });
    expect(r.store).toEqual(s);
    expect(r.apply).toEqual(fA);
  });
});

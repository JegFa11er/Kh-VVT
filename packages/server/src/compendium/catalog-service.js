"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INDEX_SUFFIX = ".index.json";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeCategoryId(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    return null;
  }
  return id;
}

function normalizeTraitsFilter(value) {
  if (value === null || value === undefined) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  const result = [];
  for (const entry of list) {
    if (typeof entry !== "string") {
      continue;
    }
    for (const part of entry.split(",")) {
      const trait = part.trim().toLowerCase();
      if (trait !== "") {
        result.push(trait);
      }
    }
  }
  return result;
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseLevelFilter(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (Array.isArray(value)) {
    const levels = value
      .map(function (entry) {
        return Number.parseInt(String(entry), 10);
      })
      .filter(Number.isInteger);
    return levels.length > 0 ? { exact: levels } : null;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return { exact: [value] };
  }
  const text = String(value).trim();
  if (text === "") {
    return null;
  }
  const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(text);
  if (range) {
    return {
      min: Number.parseInt(range[1], 10),
      max: Number.parseInt(range[2], 10),
    };
  }
  const exact = Number.parseInt(text, 10);
  return Number.isInteger(exact) ? { exact: [exact] } : null;
}

/**
 * Read-only compendium catalog backed by `<category>.index.json` files.
 *
 * Indexes are loaded into memory when the service is constructed. Full item
 * files (`<category>.json`) are read lazily, cached by mtime, and queried by
 * item id or slug.
 */
class CatalogService {
  constructor(options) {
    const opts = options || {};
    this.directory = opts.directory
      ? path.resolve(opts.directory)
      : path.join(__dirname, "..", "..", "data", "compendiums");

    /** @type {Map<string, {id:string, file:string, fullFile:string, entries:object[]}>} */
    this._indexes = new Map();
    /** @type {Map<string, {mtimeMs:number, size:number, items:object[], byId:Map<string,object>, bySlug:Map<string,object>}>} */
    this._itemCache = new Map();

    this._loadIndexes();
  }

  _ensureDirectory() {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
  }

  _loadIndexes() {
    this._ensureDirectory();
    this._indexes.clear();

    const entries = fs.readdirSync(this.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(INDEX_SUFFIX)) {
        continue;
      }

      const fileBase = entry.name.slice(0, -INDEX_SUFFIX.length);
      const categoryId = normalizeCategoryId(fileBase);
      if (!categoryId) {
        continue;
      }

      const indexPath = path.join(this.directory, entry.name);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      } catch (error) {
        console.warn("Skipping invalid compendium index " + entry.name + ": " + error.message);
        continue;
      }

      if (!Array.isArray(parsed)) {
        console.warn("Skipping compendium index " + entry.name + ": expected an array.");
        continue;
      }

      this._indexes.set(categoryId, {
        id: categoryId,
        file: entry.name,
        fullFile: categoryId + ".json",
        entries: parsed,
      });
    }
  }

  /** Drop every cache and re-read the index files from disk. */
  reload() {
    this._itemCache.clear();
    this._loadIndexes();
  }

  /** @returns {boolean} */
  hasCategory(categoryId) {
    const id = normalizeCategoryId(categoryId);
    return id !== null && this._indexes.has(id);
  }

  /** @returns {{id:string, file:string, fullFile:string, entries:object[]}|null} */
  getCategory(categoryId) {
    const id = normalizeCategoryId(categoryId);
    if (id === null) {
      return null;
    }
    return this._indexes.get(id) || null;
  }

  /** @returns {{id:string, name:string, count:number, file:string}[]} */
  listCategories() {
    const categories = [];
    for (const catalog of this._indexes.values()) {
      categories.push({
        id: catalog.id,
        name: catalog.id.charAt(0).toUpperCase() + catalog.id.slice(1),
        count: catalog.entries.length,
        file: catalog.fullFile,
      });
    }
    categories.sort(function (a, b) {
      return a.id.localeCompare(b.id);
    });
    return categories;
  }

  /** Backwards-compatible alias used by the original server wiring. */
  listCatalogs() {
    return this.listCategories().map(function (category) {
      return {
        id: category.id,
        file: category.file,
        count: category.count,
      };
    });
  }

  /**
   * Filter an index by name, level, traits or type.
   *
   * Supported filters:
   *   - name / search / q: case-insensitive substring
   *   - level: exact number, "3", or a range "1-5"
   *   - minLevel / maxLevel: inclusive bounds
   *   - traits: string or string[]; all traits must match unless traitMode/any
   *   - traitMode: "all" (default) or "any"
   *   - type: exact match
   *   - limit, offset: optional pagination (no default limit)
   *
   * @param {string} categoryId
   * @param {object} [filters]
   * @returns {object[]}
   */
  getIndex(categoryId, filters) {
    const catalog = this.getCategory(categoryId);
    if (!catalog) {
      return [];
    }
    return CatalogService.filterIndex(catalog.entries, filters);
  }

  static filterIndex(entries, filters) {
    const opts = filters || {};
    const nameFilter = isNonEmptyString(opts.name)
      ? opts.name
      : isNonEmptyString(opts.search)
        ? opts.search
        : isNonEmptyString(opts.q)
          ? opts.q
          : null;
    const normalizedName = nameFilter === null ? null : normalizeText(nameFilter);

    const levelFilter = parseLevelFilter(opts.level);
    const minLevel = readNonNegativeInteger(opts.minLevel);
    const maxLevel = readNonNegativeInteger(opts.maxLevel);
    const traits = normalizeTraitsFilter(
      opts.traits !== undefined ? opts.traits : opts.trait,
    );
    const traitMode = String(opts.traitMode || opts.match || "").toLowerCase() === "any"
      ? "any"
      : "all";
    const type = isNonEmptyString(opts.type) ? opts.type.trim().toLowerCase() : null;
    const limit = readNonNegativeInteger(opts.limit);
    const offset = readNonNegativeInteger(opts.offset);

    let result = entries.filter(function (entry) {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      if (normalizedName !== null) {
        if (!isNonEmptyString(entry.name) || !normalizeText(entry.name).includes(normalizedName)) {
          return false;
        }
      }

      const level = typeof entry.level === "number" ? entry.level : null;
      if (levelFilter !== null) {
        if (level === null) {
          return false;
        }
        if (levelFilter.exact && levelFilter.exact.indexOf(level) === -1) {
          return false;
        }
        if (levelFilter.min !== undefined && level < levelFilter.min) {
          return false;
        }
        if (levelFilter.max !== undefined && level > levelFilter.max) {
          return false;
        }
      }
      if (minLevel !== null && (level === null || level < minLevel)) {
        return false;
      }
      if (maxLevel !== null && (level === null || level > maxLevel)) {
        return false;
      }

      if (traits.length > 0) {
        const entryTraits = Array.isArray(entry.traits)
          ? entry.traits.map(function (trait) {
              return String(trait).trim().toLowerCase();
            })
          : [];
        const matches =
          traitMode === "any"
            ? traits.some(function (trait) {
                return entryTraits.indexOf(trait) !== -1;
              })
            : traits.every(function (trait) {
                return entryTraits.indexOf(trait) !== -1;
              });
        if (!matches) {
          return false;
        }
      }

      if (type !== null) {
        if (!isNonEmptyString(entry.type) || entry.type.toLowerCase() !== type) {
          return false;
        }
      }

      return true;
    });

    if (offset !== null && offset > 0) {
      result = result.slice(offset);
    }
    if (limit !== null) {
      result = result.slice(0, limit);
    }

    return result;
  }

  _loadItems(categoryId) {
    const catalog = this.getCategory(categoryId);
    if (!catalog) {
      return null;
    }

    const fullPath = path.join(this.directory, catalog.fullFile);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const stat = fs.statSync(fullPath);
    const cached = this._itemCache.get(catalog.id);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }

    let items;
    try {
      items = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch (error) {
      console.warn("Skipping invalid compendium data " + catalog.fullFile + ": " + error.message);
      return null;
    }

    if (!Array.isArray(items)) {
      console.warn("Skipping compendium data " + catalog.fullFile + ": expected an array.");
      return null;
    }

    const byId = new Map();
    const bySlug = new Map();
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      if (item.id !== undefined && item.id !== null) {
        byId.set(String(item.id), item);
      }
      if (isNonEmptyString(item.slug)) {
        bySlug.set(item.slug, item);
      }
      if (item.system && isNonEmptyString(item.system.slug)) {
        bySlug.set(item.system.slug, item);
      }
    }

    const record = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      items: items,
      byId: byId,
      bySlug: bySlug,
    };
    this._itemCache.set(catalog.id, record);
    return record;
  }

  /**
   * Read the full `<category>.json` file and return a single item by id,
   * falling back to its slug when one is present.
   *
   * @param {string} categoryId
   * @param {string} itemId
   * @returns {object|null}
   */
  getItem(categoryId, itemId) {
    if (!isNonEmptyString(itemId)) {
      return null;
    }
    const record = this._loadItems(categoryId);
    if (!record) {
      return null;
    }
    const key = itemId.trim();
    return record.byId.get(key) || record.bySlug.get(key) || null;
  }

  /**
   * Backwards-compatible full-catalog access. Prefer getIndex() for searches.
   * @returns {{id:string,file:string,entries:object[]}|null}
   */
  getCatalog(categoryId) {
    const catalog = this.getCategory(categoryId);
    if (!catalog) {
      return null;
    }
    const record = this._loadItems(categoryId);
    return {
      id: catalog.id,
      file: catalog.fullFile,
      entries: record ? record.items : [],
    };
  }

  /** @returns {object|null} */
  getEntry(categoryId, itemId) {
    return this.getItem(categoryId, itemId);
  }
}

module.exports = {
  CatalogService,
  normalizeCategoryId,
  normalizeTraitsFilter,
};

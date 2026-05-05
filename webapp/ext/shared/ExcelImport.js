/**
 * ExcelImport — generic, config-driven Excel import helper.
 *
 * Shared across all Configuration Management apps
 * (MM Routes, SD Price, FI Limit, MM Safe Stock, …).
 *
 * Each app passes its own config to parseWorkbook():
 *   headerMap     : { "excel column alias" : "ModelFieldName" }
 *   boolFields    : ["IsAllowed", ...]   — fields parsed as boolean
 *   numericFields : ["MinQty", ...]      — fields parsed as number
 *   dateFields    : ["ValidFrom", ...]   — fields parsed as date (YYYY-MM-DD)
 *   buildRow      : function(sEnvId) → blank row object with _state / _reqItemId / ActionType
 *
 * FILE NAY PHAI DONG BO VOI:
 *   config-sd-price-fiori/.../ext/shared/ExcelImport.js
 *   conf-mm-safestock/.../ext/shared/ExcelImport.js
 */
sap.ui.define([], function () {
  "use strict";

  var ExcelImport = {

    /**
     * Parse a SheetJS workbook into an array of model-ready row objects.
     *
     * @param {object}   workbook          SheetJS workbook (from XLSX.read)
     * @param {string}   sEnvId            EnvId stamped on every new row
     * @param {object}   oConfig           App-specific configuration
     * @param {object}   oConfig.headerMap { "excel alias" : "ModelField" } — matching is
     *                                     case-insensitive and collapses extra whitespace
     * @param {string[]} [oConfig.boolFields=[]]     Model fields to coerce to boolean
     * @param {string[]} [oConfig.numericFields=[]]  Model fields to coerce to number
     * @param {string[]} [oConfig.dateFields=[]]     Model fields to coerce to YYYY-MM-DD
     * @param {Function} oConfig.buildRow  function(sEnvId) → default row object
     * @returns {{ rows: object[], errors: string[], skipped: number }}
     */
    parseWorkbook: function (workbook, sEnvId, oConfig) {
      var headerMap     = oConfig.headerMap     || {};
      var boolFields    = oConfig.boolFields    || [];
      var numericFields = oConfig.numericFields || [];
      var dateFields    = oConfig.dateFields    || [];
      var buildRow      = oConfig.buildRow      || function (e) {
        return { EnvId: e, ActionType: "C", _state: "new", _reqItemId: null };
      };

      if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
        return { rows: [], errors: ["No sheets found in workbook."], skipped: 0 };
      }

      var sheet   = workbook.Sheets[workbook.SheetNames[0]];
      var rawData = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (!rawData.length) {
        return { rows: [], errors: ["The Excel file contains no data rows."], skipped: 0 };
      }

      var rawHeaders   = Object.keys(rawData[0]);
      var headerResult = ExcelImport._mapHeaders(rawHeaders, headerMap);

      if (!Object.keys(headerResult.mapped).length) {
        var sExpected = Object.keys(headerMap)
          .filter(function (k) { return k.indexOf(" ") === -1; })
          .slice(0, 6)
          .join(", ");
        return {
          rows:    [],
          errors:  ["No recognizable column headers found. Expected columns such as: " + sExpected],
          skipped: rawData.length
        };
      }

      var rows    = [];
      var errors  = [];
      var skipped = 0;

      rawData.forEach(function (rawRow, idx) {
        var row = ExcelImport._transformRow(
          rawRow, headerResult.mapped, sEnvId, buildRow, boolFields, numericFields, dateFields
        );
        if (row) {
          rows.push(row);
        } else {
          skipped++;
          errors.push("Row " + (idx + 2) + ": all fields empty, skipped.");
        }
      });

      return { rows: rows, errors: errors, skipped: skipped };
    },

    // ── Internal helpers ──────────────────────────────────────────────────

    /** Coerce a raw Excel cell value to boolean. */
    _parseBool: function (val) {
      if (typeof val === "boolean") return val;
      if (typeof val === "number")  return val === 1;
      if (!val) return false;
      return ["yes", "true", "x", "1", "y"].indexOf(
        String(val).trim().toLowerCase()
      ) !== -1;
    },

    /** Coerce a raw Excel cell value to number. */
    _parseNumber: function (val) {
      if (typeof val === "number") return val;
      if (!val) return 0;
      var num = parseFloat(String(val).trim().replace(/,/g, ""));
      return isNaN(num) ? 0 : num;
    },

    /** Coerce a raw Excel cell value to YYYY-MM-DD date string. */
    _parseDate: function (val) {
      if (!val) return null;
      // Handle Excel serial date numbers
      if (typeof val === "number") {
        var d = new Date((val - 25569) * 86400 * 1000);
        return ExcelImport._formatDate(d);
      }
      var sVal = String(val).trim();
      // Already in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(sVal)) return sVal;
      var d2 = new Date(sVal);
      if (isNaN(d2.getTime())) return sVal; // return as-is, validation will catch it
      return ExcelImport._formatDate(d2);
    },

    /** Format a Date object to YYYY-MM-DD. */
    _formatDate: function (d) {
      var y   = d.getFullYear();
      var m   = ("0" + (d.getMonth() + 1)).slice(-2);
      var day = ("0" + d.getDate()).slice(-2);
      return y + "-" + m + "-" + day;
    },

    /** Normalize an Excel header for lookup: trim, lowercase, collapse spaces. */
    _normalize: function (s) {
      return String(s).trim().toLowerCase().replace(/\s+/g, " ");
    },

    /**
     * Match raw Excel headers against the caller's headerMap.
     * Returns { mapped: { "Raw Excel Col" : "ModelField" } }.
     */
    _mapHeaders: function (rawHeaders, headerMap) {
      var mapped = {};
      rawHeaders.forEach(function (h) {
        var sKey = ExcelImport._normalize(h);
        if (headerMap[sKey]) {
          mapped[h] = headerMap[sKey];
        }
      });
      return { mapped: mapped };
    },

    /**
     * Convert one raw data row into a model row using the resolved header mapping.
     * Returns null if the row contains no usable data (all empty → skip).
     */
    _transformRow: function (rawRow, headerMapping, sEnvId, buildRow, boolFields, numericFields, dateFields) {
      var row     = buildRow(sEnvId);
      var hasData = false;

      Object.keys(headerMapping).forEach(function (excelCol) {
        var modelField = headerMapping[excelCol];
        var val        = rawRow[excelCol];
        if (val === undefined || val === null) return;

        if (boolFields.indexOf(modelField) !== -1) {
          row[modelField] = ExcelImport._parseBool(val);
          hasData = true;
        } else if (numericFields.indexOf(modelField) !== -1) {
          row[modelField] = ExcelImport._parseNumber(val);
          hasData = true;
        } else if (dateFields.indexOf(modelField) !== -1) {
          var dateVal = ExcelImport._parseDate(val);
          if (dateVal) {
            row[modelField] = dateVal;
            hasData = true;
          }
        } else {
          var sVal = String(val).trim();
          if (sVal) {
            row[modelField] = sVal;
            hasData = true;
          }
        }
      });

      return hasData ? row : null;
    }
  };

  return ExcelImport;
});

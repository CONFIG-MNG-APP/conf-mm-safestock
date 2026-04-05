/**
 * ExcelImport — generic, config-driven Excel import helper.
 *
 * Each app passes its own config to parseWorkbook():
 *   headerMap  : { "excel column alias" : "ModelFieldName" }
 *   boolFields : ["IsAllowed", ...]   — fields parsed as boolean
 *   buildRow   : function(sEnvId) → blank row object with _state / _reqItemId / ActionType
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
     * @param {object}   oConfig.headerMap { "excel alias" : "ModelField" }
     * @param {string[]} [oConfig.boolFields=[]]  Model fields to coerce to boolean
     * @param {Function} oConfig.buildRow  function(sEnvId) → default row object
     * @returns {{ rows: object[], errors: string[], skipped: number }}
     */
    parseWorkbook: function (workbook, sEnvId, oConfig) {
      var headerMap  = oConfig.headerMap  || {};
      var boolFields = oConfig.boolFields || [];
      var buildRow   = oConfig.buildRow   || function (e) {
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
          skipped: rawData.length,
        };
      }

      var rows    = [];
      var errors  = [];
      var skipped = 0;

      rawData.forEach(function (rawRow, idx) {
        var row = ExcelImport._transformRow(
          rawRow, headerResult.mapped, sEnvId, buildRow, boolFields
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

    _parseBool: function (val) {
      if (typeof val === "boolean") return val;
      if (typeof val === "number")  return val === 1;
      if (!val) return false;
      return ["yes", "true", "x", "1", "y"].indexOf(
        String(val).trim().toLowerCase()
      ) !== -1;
    },

    _normalize: function (s) {
      return String(s).trim().toLowerCase().replace(/\s+/g, " ");
    },

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

    _transformRow: function (rawRow, headerMapping, sEnvId, buildRow, boolFields) {
      var row     = buildRow(sEnvId);
      var hasData = false;

      Object.keys(headerMapping).forEach(function (excelCol) {
        var modelField = headerMapping[excelCol];
        var val        = rawRow[excelCol];
        if (val === undefined || val === null) return;

        if (boolFields.indexOf(modelField) !== -1) {
          row[modelField] = ExcelImport._parseBool(val);
          hasData = true;
        } else {
          var sVal = String(val).trim();
          if (sVal) {
            row[modelField] = sVal;
            hasData = true;
          }
        }
      });

      return hasData ? row : null;
    },
  };

  return ExcelImport;
});

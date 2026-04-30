sap.ui.define(
  [
    "zgsp26/conf/mng/mmsafestock/confmngfemmsafestock/ext/shared/ConfMngBaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "../shared/ExcelImport",
  ],
  function (
    BaseController,
    MessageToast,
    MessageBox,
    JSONModel,
    Filter,
    FilterOperator,
    SelectDialog,
    StandardListItem,
    ExcelImport,
  ) {
    "use strict";

    return BaseController.extend(
      "zgsp26.conf.mng.mmsafestock.confmngfemmsafestock.ext.view.Main",
      {
        // ── Abstract overrides ────────────────────────────────────────────
        _getModuleId: function () { return "MM"; },
        _getConfName: function () { return "MM Safe Stock Configuration"; },
        _getTargetCds: function () { return "ZI_MM_SAFE_STOCK"; },

        // ── Excel import config (SafeStock specific) ──────────────────────
        _getExcelImportConfig: function () {
          return {
            headerMap: {
              "plant": "PlantId",
              "plantid": "PlantId",
              "plant_id": "PlantId",
              "plant id": "PlantId",
              "matgroup": "MatGroup",
              "mat group": "MatGroup",
              "mat_group": "MatGroup",
              "material group": "MatGroup",
              "minqty": "MinQty",
              "min qty": "MinQty",
              "min_qty": "MinQty",
              "minimum qty": "MinQty",
              "minimum quantity": "MinQty",
              "changenote": "ChangeNote",
              "change note": "ChangeNote",
              "change_note": "ChangeNote",
              "note": "ChangeNote",
            },
            boolFields: [],
            buildRow: function (sEnvId) {
              return {
                ItemId: "",
                EnvId: sEnvId || "DEV",
                PlantId: "",
                MatGroup: "",
                MinQty: 0,
                VersionNo: 0,
                ChangeNote: "",
                ActionType: "C",
                _state: "new",
                _reqItemId: null,
              };
            },
          };
        },

        onInit: function () {
          this._oModel = this.getView().getModel() || this.getOwnerComponent().getModel();
          this._aMainRows = [];
          this._aFieldDef = [];
          this.getView().setModel(new JSONModel({ rows: [] }), "tableData");

          const oUIModel = new JSONModel({
            editMode: true, requestCreated: false, viewOnly: false,
            totalCount: 0, createCount: 0, updateCount: 0, deleteCount: 0,
            rowCountText: "",
          });
          this.getView().setModel(oUIModel, "ui");

          const oFilterModel = new JSONModel({
            EnvId: "", PlantId: "", MatGroup: "", Search: "",
          });
          this.getView().setModel(oFilterModel, "filter");

          const oRequestContext = this._getUrlParams();
          this.getView().setModel(new JSONModel(oRequestContext), "requestContext");

          const bHasReqId = !!oRequestContext.ReqId;
          const sStatus = oRequestContext.Status || (bHasReqId ? "Draft" : "Not Created");
          const oRequestModel = new JSONModel({
            ReqId: oRequestContext.ReqId || "",
            ReqItemId: "",
            ConfId: oRequestContext.ConfId || "",
            ReqTitle: "",
            Status: sStatus,
            StatusState: this._statusToState(sStatus),
            Reason: "",
          });
          this.getView().setModel(oRequestModel, "request");

          // Load value help data for SelectDialogs
          this._loadValueHelps();

          if (oRequestContext.ConfId) {
            this._fetchFieldDef(oRequestContext.ConfId);
          }

          if (bHasReqId) {
            const bIsDraft = sStatus.toUpperCase() === "DRAFT";
            const bIsRejected = sStatus.toUpperCase() === "REJECTED";
            const bCanEdit = bIsDraft || bIsRejected;
            oUIModel.setProperty("/requestCreated", true);
            oUIModel.setProperty("/editMode", bIsDraft);   // auto-edit only for Draft
            oUIModel.setProperty("/viewOnly", !bCanEdit);  // lock for Submitted/Approved/etc.
            this._fetchRequestHeader(oRequestContext.ReqId);
            this._fetchReqItem(oRequestContext.ReqId);
            this._loadMainTableWithOverlay(oRequestContext.EnvId, oRequestContext.ReqId);
          } else if (oRequestContext.Mode === "VIEW") {
            oUIModel.setProperty("/editMode", false);
            oUIModel.setProperty("/viewOnly", true);
            this._loadMainTable(oRequestContext.EnvId || "DEV");
          }

          console.log("requestContext =", oRequestContext);
        },

        onCancel: async function () {
          const oView = this.getView();
          const sReqId = oView.getModel("request").getProperty("/ReqId");
          const sEnvId = oView.getModel("requestContext").getProperty("/EnvId") || "DEV";

          oView.setBusy(true);
          try {
            if (sReqId) {
              await this._loadMainTableWithOverlay(sEnvId, sReqId);
            } else {
              oView.getModel("tableData").setProperty("/rows", this._aMainRows.map(r => ({ ...r })));
            }
            this._applyBaseFilter();
          } finally {
            oView.setBusy(false);
          }
          oView.getModel("ui").setProperty("/editMode", false);
          MessageToast.show("Changes discarded");
        },

        onCreate: function () {
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          if (!sReqId) {
            MessageBox.warning("Please create a request first before adding lines.");
            return;
          }
          const oTableModel = this.getView().getModel("tableData");
          const aRows = oTableModel.getProperty("/rows");
          aRows.unshift({
            ItemId: "",
            EnvId: this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV",
            PlantId: "",
            MatGroup: "",
            MinQty: 0,
            VersionNo: 0,
            ChangeNote: "",
            ActionType: "C",
            _state: "new",
            _reqItemId: null,
          });
          oTableModel.setProperty("/rows", aRows);
          this._applyBaseFilter();
          MessageToast.show("New line added — fill in the fields and save.");
        },

        onDelete: function () {
          const oTable = this.byId("safeStockTable");
          const aItems = oTable.getSelectedItems();
          if (!aItems.length) { MessageToast.show("Select row(s) to delete"); return; }

          MessageBox.confirm("Delete selected row(s)?", {
            onClose: (sAction) => {
              if (sAction !== "OK") return;
              const oTableModel = this.getView().getModel("tableData");
              const aRows = oTableModel.getProperty("/rows");

              aItems.forEach(oItem => {
                const oCtx = oItem.getBindingContext("tableData");
                if (!oCtx) return;
                const oRow = oCtx.getObject();
                const iIdx = aRows.indexOf(oRow);
                if (iIdx < 0) return;
                if (oRow._state === "new") {
                  aRows.splice(iIdx, 1);
                } else {
                  aRows[iIdx]._state = "deleted";
                  aRows[iIdx].ActionType = "X";
                }
              });

              oTableModel.setProperty("/rows", aRows);
              this._applyBaseFilter();
              MessageToast.show("Marked for deletion — save to confirm.");
            },
          });
        },

        /* ── Import from Excel ─────────────────────────────── */

        _xlsxPromise: null,

        _ensureXlsxLoaded: function () {
          if (window.XLSX) return Promise.resolve();
          if (this._xlsxPromise) return this._xlsxPromise;
          var sPath = sap.ui.require.toUrl(
            "zgsp26/conf/mng/mmsafestock/confmngfemmsafestock/lib/xlsx.min"
          ) + ".js";
          this._xlsxPromise = new Promise(function (resolve, reject) {
            var oScript = document.createElement("script");
            oScript.src = sPath;
            oScript.onload = resolve;
            oScript.onerror = function () { reject(new Error("Failed to load SheetJS library")); };
            document.head.appendChild(oScript);
          });
          return this._xlsxPromise;
        },

        onImportFromExcel: function () {
          var that = this;
          var sReqId = this.getView().getModel("request").getProperty("/ReqId");
          if (!sReqId) {
            MessageBox.warning("Please create a request first before importing.");
            return;
          }
          this._ensureXlsxLoaded().then(function () {
            var oInput = document.createElement("input");
            oInput.type = "file";
            oInput.accept = ".xls,.xlsx,.csv";
            oInput.style.display = "none";
            document.body.appendChild(oInput);
            oInput.addEventListener("change", function (oEvent) {
              var oFile = oEvent.target.files[0];
              if (!oFile) { document.body.removeChild(oInput); return; }
              var oReader = new FileReader();
              oReader.onload = function (e) {
                try {
                  that._processExcelData(e.target.result);
                } catch (err) {
                  MessageBox.error("Could not read the Excel file: " + err.message);
                }
                document.body.removeChild(oInput);
              };
              oReader.onerror = function () {
                MessageBox.error("Failed to read file.");
                document.body.removeChild(oInput);
              };
              oReader.readAsArrayBuffer(oFile);
            });
            oInput.click();
          }).catch(function (err) {
            MessageBox.error("Failed to load Excel library: " + err.message);
          });
        },

        _processExcelData: function (arrayBuffer) {
          var workbook = XLSX.read(arrayBuffer, { type: "array" });
          var sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
          var result = ExcelImport.parseWorkbook(workbook, sEnvId, this._getExcelImportConfig());

          if (result.errors.length && !result.rows.length) {
            MessageBox.error(result.errors.join("\n"));
            return;
          }
          if (result.rows.length > 500) {
            var that = this;
            MessageBox.confirm(
              "The file contains " + result.rows.length + " rows. This may take a moment. Continue?",
              { onClose: function (sAction) { if (sAction === "OK") { that._insertImportedRows(result); } } }
            );
            return;
          }
          this._insertImportedRows(result);
        },

        _insertImportedRows: function (result) {
          var oTableModel = this.getView().getModel("tableData");
          var aRows = oTableModel.getProperty("/rows");
          for (var i = result.rows.length - 1; i >= 0; i--) {
            aRows.unshift(result.rows[i]);
          }
          oTableModel.setProperty("/rows", aRows);
          this._applyBaseFilter();
          var sMsg = result.rows.length + " row(s) imported from Excel.";
          if (result.skipped > 0) sMsg += "\n" + result.skipped + " row(s) skipped (empty).";
          MessageToast.show(sMsg);
        },

        /* ── End Import from Excel ─────────────────────────── */

        onSave: async function () {
          const oView = this.getView();
          const oRequestModel = oView.getModel("request");
          const sReqId = oRequestModel.getProperty("/ReqId");
          const sReqItemId = oRequestModel.getProperty("/ReqItemId") || "";
          const sTitle = oRequestModel.getProperty("/ReqTitle") || "";
          const sReason = oRequestModel.getProperty("/Reason") || "";

          const oTableModelV = oView.getModel("tableData");
          const aAllRows = oTableModelV.getProperty("/rows");
          const aErrors = this._validateRows(aAllRows);
          oTableModelV.setProperty("/rows", aAllRows);

          if (aErrors.length) {
            MessageBox.error(
              "Please fix the following errors before saving:\n\n" + aErrors.join("\n"),
              { title: "Validation Error" }
            );
            return;
          }

          oView.setBusy(true);
          try {
            const sCsrfToken = await this._fetchCsrfToken(
              this._getMmSafeStockServiceUrl() + "?sap-client=" + this._getSapClient()
            );
            if (!sCsrfToken) throw new Error("Cannot fetch CSRF token");

            const oTableModel = oView.getModel("tableData");
            const aRows = oTableModel.getProperty("/rows");
            const sConfId = oRequestModel.getProperty("/ConfId") || "";

            if (!sReqItemId) {
              oView.setBusy(false);
              MessageBox.error("Cannot save: Request item not loaded. Please refresh and try again.");
              return;
            }

            const mOrig = {};
            this._aMainRows.forEach(r => { mOrig[r.ItemId] = r; });

            let iSaved = 0;

            for (const row of aRows) {

              // ── NEW row (ActionType = 'C') ───────────────────────────────
              if (row._state === "new") {
                const oCreated = await this._postAndActivateReqRow({
                  ReqId: sReqId,
                  ReqItemId: sReqItemId,
                  ConfId: sConfId,
                  ActionType: "C",
                  EnvId: row.EnvId || "",
                  PlantId: row.PlantId || "",
                  MatGroup: row.MatGroup || "",
                  MinQty: parseInt(row.MinQty, 10) || 0,
                  ChangeNote: row.ChangeNote || "",
                }, sCsrfToken);
                if (oCreated?.ItemId) {
                  row._state = "new";   // keep badge
                  row._reqItemId = { ReqId: oCreated.ReqId, ReqItemId: oCreated.ReqItemId, ItemId: oCreated.ItemId };
                  iSaved++;
                }
                continue;
              }

              // ── DELETED row (ActionType = 'X') ───────────────────────────
              if (row._state === "deleted") {
                if (!row._reqItemId) {
                  const orig = mOrig[row.ItemId] || row;
                  await this._postAndActivateReqRow({
                    ReqId: sReqId,
                    ReqItemId: sReqItemId,
                    ConfId: sConfId,
                    ActionType: "X",
                    SourceItemId: row.ItemId,
                    EnvId: row.EnvId || "",
                    PlantId: row.PlantId || "",
                    MatGroup: row.MatGroup || "",
                    MinQty: parseInt(row.MinQty, 10) || 0,
                    VersionNo: row.VersionNo || 0,
                    ChangeNote: row.ChangeNote || "",
                    OldEnvId: orig.EnvId || "",
                    OldPlantId: orig.PlantId || "",
                    OldMatGroup: orig.MatGroup || "",
                    OldMinQty: parseInt(orig.MinQty, 10) || 0,
                    OldVersionNo: orig.VersionNo || 0,
                  }, sCsrfToken);
                } else {
                  await this._editPatchActivateReqRow(
                    row._reqItemId, { ActionType: "X" }, sCsrfToken
                  );
                }
                iSaved++;
                continue;
              }

              // ── UNCHANGED main row — check if any field changed ──────────
              if (!row.ItemId) continue;
              const orig = mOrig[row.ItemId];
              if (!orig) continue;

              const bChanged =
                (row.PlantId || "") !== (orig.PlantId || "") ||
                (row.MatGroup || "") !== (orig.MatGroup || "") ||
                String(row.MinQty || 0) !== String(orig.MinQty || 0) ||
                !!(row.ChangeNote || "").trim();

              if (!bChanged) continue;

              if (!row._reqItemId) {
                const oCreated = await this._postAndActivateReqRow({
                  ReqId: sReqId,
                  ReqItemId: sReqItemId,
                  ConfId: sConfId,
                  ActionType: "U",
                  SourceItemId: row.ItemId,
                  EnvId: row.EnvId || "",
                  PlantId: row.PlantId || "",
                  MatGroup: row.MatGroup || "",
                  MinQty: parseInt(row.MinQty, 10) || 0,
                  VersionNo: orig.VersionNo || 0,
                  ChangeNote: row.ChangeNote || "",
                  OldEnvId: orig.EnvId || "",
                  OldPlantId: orig.PlantId || "",
                  OldMatGroup: orig.MatGroup || "",
                  OldMinQty: parseInt(orig.MinQty, 10) || 0,
                  OldVersionNo: orig.VersionNo || 0,
                }, sCsrfToken);
                if (oCreated?.ItemId) {
                  row._state = "modified";
                  row._reqItemId = { ReqId: oCreated.ReqId, ReqItemId: oCreated.ReqItemId, ItemId: oCreated.ItemId };
                  row.ActionType = "U";
                  iSaved++;
                }
              } else {
                await this._editPatchActivateReqRow(
                  row._reqItemId,
                  {
                    PlantId: row.PlantId || "",
                    MatGroup: row.MatGroup || "",
                    MinQty: parseInt(row.MinQty, 10) || 0,
                    ChangeNote: row.ChangeNote || "",
                  },
                  sCsrfToken
                );
                iSaved++;
              }
            }

            oTableModel.setProperty("/rows", aRows);
            await this._patchRequestHeader(sReqId, sTitle, sReason);

            const sEnvId = oView.getModel("requestContext").getProperty("/EnvId") || "DEV";
            await this._loadMainTableWithOverlay(sEnvId, sReqId);

            oView.getModel("ui").setProperty("/editMode", false);
            this._applyBaseFilter();
            MessageToast.show(iSaved > 0
              ? iSaved + " change(s) saved to request."
              : "No changes detected.");
          } catch (e) {
            console.error(e);
            MessageBox.error(e?.message || "Save failed");
          } finally {
            oView.setBusy(false);
          }
        },

        onRefresh: async function () {
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
          this.getView().setBusy(true);
          try {
            if (sReqId) {
              await this._loadMainTableWithOverlay(sEnvId, sReqId);
            } else {
              await this._loadMainTable(sEnvId);
            }
            this._applyBaseFilter();
            MessageToast.show("Refreshed");
          } catch (e) {
            MessageBox.error("Refresh failed");
          } finally {
            this.getView().setBusy(false);
          }
        },

        onSearch: function () {
          const oTable = this.byId("safeStockTable");
          const oBinding = oTable.getBinding("items");
          const oFilterData = this.getView().getModel("filter").getData();
          const aFilters = [];

          if (oFilterData.EnvId) aFilters.push(new Filter("EnvId", FilterOperator.Contains, oFilterData.EnvId));
          if (oFilterData.PlantId) aFilters.push(new Filter("PlantId", FilterOperator.Contains, oFilterData.PlantId));
          if (oFilterData.MatGroup) aFilters.push(new Filter("MatGroup", FilterOperator.Contains, oFilterData.MatGroup));

          const sSearch = this.byId("searchField").getValue();
          if (sSearch) {
            aFilters.push(new Filter({
              filters: [
                new Filter("EnvId", FilterOperator.Contains, sSearch),
                new Filter("PlantId", FilterOperator.Contains, sSearch),
                new Filter("MatGroup", FilterOperator.Contains, sSearch),
              ],
              and: false,
            }));
          }

          oBinding.filter(aFilters);
        },

        // ── Private helpers ──────────────────────────────────────────────

        /**
         * Fetch all value help lists at startup and store in the "vh" JSONModel.
         * Uses the req service for EnvDef + PlantUnit (already exposed there),
         * and the safe stock service for MatGroupVH (ZC_VH_MATL_GRP).
         */
        _loadValueHelps: async function () {
          const sSapClient = this._getSapClient();
          const sSsBase = this._getMmSafeStockServiceUrl();
          const oHeaders = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };

          // All 3 VH entity sets are exposed directly in the safe stock service (ZSD_MM_SAFE_STOCK):
          //   ZC_ENV_DEF            → alias EnvDef
          //   ZC_PLANT_UNIT         → alias PlantUnit
          //   ZC_VH_MATL_GRP        → alias MatGroupVH
          const [oEnvResp, oPlantResp, oMatGrpResp] = await Promise.allSettled([
            fetch(sSsBase + "EnvDef?$select=EnvId,Description&$orderby=EnvId&sap-client=" + sSapClient,
              { headers: oHeaders, credentials: "include" }),
            fetch(sSsBase + "PlantUnit?$select=PlantId,Description&$orderby=PlantId&sap-client=" + sSapClient,
              { headers: oHeaders, credentials: "include" }),
            fetch(sSsBase + "MatGroupVH?$select=MatlGrp,Description&$orderby=MatlGrp&sap-client=" + sSapClient,
              { headers: oHeaders, credentials: "include" }),
          ]);

          const _val = async (settled) => {
            if (settled.status !== "fulfilled" || !settled.value.ok) return [];
            return (await settled.value.json()).value || [];
          };

          const [aEnv, aPlant, aMatGrp] = await Promise.all([
            _val(oEnvResp), _val(oPlantResp), _val(oMatGrpResp),
          ]);

          this.getView().setModel(new JSONModel({
            EnvDef: aEnv,
            PlantUnit: aPlant,
            MatGroupVH: aMatGrp,
          }), "vh");

          console.log("[VH] EnvDef:", aEnv.length, "PlantUnit:", aPlant.length, "MatGroupVH:", aMatGrp.length);
        },

        _validateRows: function (aRows) {
          const aErrors = [];
          const aFieldDef = this._aFieldDef || [];
          const aRequired = aFieldDef.length > 0
            ? aFieldDef.filter(function (f) { return f.IsRequired; })
            : [
              { FieldName: "PLANT_ID", FieldLabel: "Plant" },
              { FieldName: "MAT_GROUP", FieldLabel: "Material Group" },
            ];

          // Build a Set of valid MatGroup keys from the loaded value-help
          const oVhModel = this.getView().getModel("vh");
          const aMatGrpVH = oVhModel ? (oVhModel.getProperty("/MatGroupVH") || []) : [];
          const oValidMatGroups = new Set(aMatGrpVH.map(function (vh) { return vh.MatlGrp; }));
          const aPlantVH = oVhModel ? (oVhModel.getProperty("/PlantUnit") || []) : [];
          const oValidPlants = new Set(aPlantVH.map(function (vh) { return vh.PlantId; }));

          aRows.forEach(function (row, iIdx) {
            Object.keys(row).forEach(function (k) {
              if (k.startsWith("_vs_")) row[k] = "None";
            });
            if (row._state === "deleted") return;
            const sRowNum = "Row " + (iIdx + 1);

            aRequired.forEach(function (fieldDef) {
              const sJsKey = this._dbToPascal(fieldDef.FieldName);
              const sVsKey = "_vs_" + sJsKey;
              const sVal = String(row[sJsKey] ?? "").trim();
              if (!sVal) {
                row[sVsKey] = "Error";
                aErrors.push(sRowNum + ": " + fieldDef.FieldLabel + " is required.");
              }
            }.bind(this));

            // Extra check: PlantId must exist in master data
            const sPlantId = String(row.PlantId ?? "").trim();
            if (sPlantId && aPlantVH.length > 0 && !oValidPlants.has(sPlantId)) {
              row["_vs_PlantId"] = "Error";
              aErrors.push(sRowNum + ": Plant '" + sPlantId + "' does not exist. Please select a valid value.");
            }

            // Extra check: MatGroup value must exist in master data
            const sMatGroup = String(row.MatGroup ?? "").trim();
            if (sMatGroup && aMatGrpVH.length > 0 && !oValidMatGroups.has(sMatGroup)) {
              row["_vs_MatGroup"] = "Error";
              aErrors.push(sRowNum + ": Material Group '" + sMatGroup + "' does not exist. Please select a valid value.");
            }

            if (!row.MinQty || row.MinQty <= 0) {
              row["_vs_MinQty"] = "Error";
              aErrors.push(sRowNum + ": Min Quantity must be greater than 0.");
            }
          }.bind(this));

          // ── Duplicate business key check (PlantId + MatGroup) ────────────
          const aSeen = [];
          aRows.forEach(function (row, iIdx) {
            if (row._state === "deleted") return;
            const sPlant    = String(row.PlantId  || "").trim();
            const sMatGroup = String(row.MatGroup || "").trim();
            if (!sPlant || !sMatGroup) return;

            const sKey = sPlant + "|" + sMatGroup;
            if (aSeen.indexOf(sKey) >= 0) {
              row._vs_PlantId  = "Error";
              row._vs_MatGroup = "Error";
              aErrors.push("Row " + (iIdx + 1) + ": Duplicate entry — Plant '" + sPlant + "' + Material Group '" + sMatGroup + "' already exists in this request.");
            } else {
              aSeen.push(sKey);
            }
          });

          return aErrors;
        },

        _getMmSafeStockServiceUrl: function () {
          return "/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/";
        },

        /** Load main table only (VIEW mode — no request overlay) */
        _loadMainTable: async function (sEnvId) {
          const sUrl =
            this._getMmSafeStockServiceUrl() +
            "MMSafeStockMain?$filter=EnvId eq '" + sEnvId + "'&$orderby=PlantId,MatGroup" +
            "&sap-client=" + this._getSapClient();

          const oResp = await fetch(sUrl, {
            headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          });
          if (!oResp.ok) throw new Error("Cannot load MMSafeStockMain: " + oResp.status);

          const aRaw = (await oResp.json()).value || [];
          const aRows = aRaw.map(r => ({
            ...r,
            ActionType: "",
            ChangeNote: "",
            _state: "unchanged",
            _reqItemId: null,
          }));

          this._aMainRows = aRows.map(r => ({ ...r }));
          this.getView().getModel("tableData").setProperty("/rows", aRows);
        },

        /** Load main table + overlay with existing request delta rows */
        _loadMainTableWithOverlay: async function (sEnvId, sReqId) {
          const sBase = this._getMmSafeStockServiceUrl();
          const sSapClient = this._getSapClient();

          const [oMainResp, oReqResp] = await Promise.all([
            fetch(
              sBase + "MMSafeStockMain?$filter=EnvId eq '" + sEnvId +
              "'&$orderby=PlantId,MatGroup&sap-client=" + sSapClient,
              { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }, credentials: "include" }
            ),
            sReqId
              ? fetch(
                sBase + "MMSafeStock?$filter=ReqId eq " + sReqId +
                "&$select=ItemId,ReqId,ReqItemId,SourceItemId,ActionType,EnvId,PlantId,MatGroup,MinQty,VersionNo,ChangeNote" +
                "&$top=500&sap-client=" + sSapClient,
                { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }, credentials: "include" }
              )
              : Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) }),
          ]);

          const aMain = oMainResp.ok ? ((await oMainResp.json()).value || []) : [];
          const aReq = sReqId && oReqResp.ok ? ((await oReqResp.json()).value || []) : [];
          console.log("[SafeStock] aMain count:", aMain.length, "aReq count:", aReq.length);

          const isBlankId = id => !id || id === "00000000-0000-0000-0000-000000000000";

          // Map SourceItemId → req row (for U / X rows)
          const mReq = {};
          aReq.forEach(r => { if (!isBlankId(r.SourceItemId)) mReq[r.SourceItemId] = r; });

          // Merge: main rows overlaid with saved delta
          const aRows = aMain.map(mainRow => {
            const req = mReq[mainRow.ItemId];
            if (req) {
              return {
                ...req,
                _state: req.ActionType === "X" ? "deleted" : "modified",
                _reqItemId: { ReqId: req.ReqId, ReqItemId: req.ReqItemId, ItemId: req.ItemId },
              };
            }
            return { ...mainRow, ActionType: "", ChangeNote: "", _state: "unchanged", _reqItemId: null };
          });

          // Append CREATE-only rows (no SourceItemId)
          aReq.filter(r => isBlankId(r.SourceItemId)).forEach(r => {
            aRows.push({ ...r, _state: "new", _reqItemId: { ReqId: r.ReqId, ReqItemId: r.ReqItemId, ItemId: r.ItemId } });
          });

          // Append DELETE rows whose source no longer exists in main (already promoted)
          const aMainIds = new Set(aMain.map(r => r.ItemId));
          aReq.filter(r => r.ActionType === "X" && !isBlankId(r.SourceItemId) && !aMainIds.has(r.SourceItemId))
            .forEach(r => {
              aRows.push({ ...r, _state: "deleted", _reqItemId: { ReqId: r.ReqId, ReqItemId: r.ReqItemId, ItemId: r.ItemId } });
            });

          this._aMainRows = aMain.map(r => ({ ...r }));
          this.getView().getModel("tableData").setProperty("/rows", aRows);
        },

        /** POST payload to MMSafeStock → draft, then Activate → active entity */
        _postAndActivateReqRow: async function (oPayload, sCsrfToken) {
          const sBase = this._getMmSafeStockServiceUrl();
          const sSapClient = this._getSapClient();
          const sNs = "com.sap.gateway.srvd.zsd_mm_safe_stock.v0001";
          const oHeaders = {
            "Content-Type": "application/json",
            "X-CSRF-Token": sCsrfToken,
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json",
          };

          const oPostResp = await fetch(sBase + "MMSafeStock?sap-client=" + sSapClient, {
            method: "POST",
            headers: oHeaders,
            credentials: "include",
            body: JSON.stringify(oPayload),
          });
          if (!oPostResp.ok) {
            const oErr = await oPostResp.json().catch(() => ({}));
            throw new Error(oErr?.error?.message || "POST req row failed (" + oPostResp.status + ")");
          }
          const oDraft = await oPostResp.json();

          const sDraftKey =
            "ReqId=" + oDraft.ReqId +
            ",ReqItemId=" + oDraft.ReqItemId +
            ",ItemId=" + oDraft.ItemId;
          const sActivateUrl =
            sBase + "MMSafeStock(" + sDraftKey + ",IsActiveEntity=false)/" +
            sNs + ".Activate?sap-client=" + sSapClient;
          const oActResp = await fetch(sActivateUrl, {
            method: "POST",
            headers: oHeaders,
            credentials: "include",
            body: JSON.stringify({}),
          });
          if (!oActResp.ok) {
            const oActErr = await oActResp.json().catch(() => ({}));
            throw new Error(this._extractODataError(oActErr) || "Activate failed (" + oActResp.status + ")");
          }
          return oActResp.json();
        },

        /** Edit (create draft) → PATCH draft → Activate
         *  @param {object} oKeys  { ReqId, ReqItemId, ItemId } of the active entity
         */
        _editPatchActivateReqRow: async function (oKeys, oPayload, sCsrfToken) {
          const sBase = this._getMmSafeStockServiceUrl();
          const sSapClient = this._getSapClient();
          const sNs = "com.sap.gateway.srvd.zsd_mm_safe_stock.v0001";
          const oHeaders = {
            "Content-Type": "application/json",
            "X-CSRF-Token": sCsrfToken,
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json",
          };

          const sActiveKey =
            "ReqId=" + oKeys.ReqId +
            ",ReqItemId=" + oKeys.ReqItemId +
            ",ItemId=" + oKeys.ItemId;

          // Try PATCH draft directly (may already exist)
          const oPatchDraftResp = await fetch(
            sBase + "MMSafeStock(" + sActiveKey + ",IsActiveEntity=false)?sap-client=" + sSapClient,
            { method: "PATCH", headers: oHeaders, credentials: "include", body: JSON.stringify(oPayload) }
          );
          if (oPatchDraftResp.ok) {
            const oActResp = await fetch(
              sBase + "MMSafeStock(" + sActiveKey + ",IsActiveEntity=false)/" + sNs + ".Activate?sap-client=" + sSapClient,
              { method: "POST", headers: oHeaders, credentials: "include", body: JSON.stringify({}) }
            );
            if (!oActResp.ok) {
              const oErr = await oActResp.json().catch(() => ({}));
              throw new Error(this._extractODataError(oErr) || "Activate failed (" + oActResp.status + ")");
            }
            return;
          }

          // Fallback: Edit → PATCH → Activate
          const oEditResp = await fetch(
            sBase + "MMSafeStock(" + sActiveKey + ",IsActiveEntity=true)/" + sNs + ".Edit?sap-client=" + sSapClient,
            { method: "POST", headers: oHeaders, credentials: "include", body: JSON.stringify({ PreserveChanges: false }) }
          );
          if (!oEditResp.ok) {
            const oErr = await oEditResp.json().catch(() => ({}));
            throw new Error(oErr?.error?.message || "Edit action failed (" + oEditResp.status + ")");
          }
          const oDraft = await oEditResp.json();

          const sDraftKey =
            "ReqId=" + (oDraft.ReqId || oKeys.ReqId) +
            ",ReqItemId=" + (oDraft.ReqItemId || oKeys.ReqItemId) +
            ",ItemId=" + (oDraft.ItemId || oKeys.ItemId);

          const oPatchResp = await fetch(
            sBase + "MMSafeStock(" + sDraftKey + ",IsActiveEntity=false)?sap-client=" + sSapClient,
            { method: "PATCH", headers: oHeaders, credentials: "include", body: JSON.stringify(oPayload) }
          );
          if (!oPatchResp.ok) {
            const oErr = await oPatchResp.json().catch(() => ({}));
            throw new Error(oErr?.error?.message || "PATCH draft failed (" + oPatchResp.status + ")");
          }

          const oActResp = await fetch(
            sBase + "MMSafeStock(" + sDraftKey + ",IsActiveEntity=false)/" + sNs + ".Activate?sap-client=" + sSapClient,
            { method: "POST", headers: oHeaders, credentials: "include", body: JSON.stringify({}) }
          );
          if (!oActResp.ok) {
            const oErr = await oActResp.json().catch(() => ({}));
            throw new Error(this._extractODataError(oErr) || "Activate failed (" + oActResp.status + ")");
          }
        },

        _applyBaseFilter: function () {
          const oBinding = this.byId("safeStockTable").getBinding("items");
          if (oBinding) oBinding.filter([]);
          this._updateStats();
        },

        _updateStats: function () {
          const oUI = this.getView().getModel("ui");
          const aRows = this.getView().getModel("tableData").getProperty("/rows") || [];
          let iCreate = 0, iUpdate = 0, iDelete = 0;
          aRows.forEach(function (r) {
            if (r.ActionType === "C") iCreate++;
            else if (r.ActionType === "U") iUpdate++;
            else if (r.ActionType === "X") iDelete++;
          });
          const iVisible = aRows.filter(function (r) { return r._state !== "deleted"; }).length;
          oUI.setProperty("/totalCount", aRows.length);
          oUI.setProperty("/createCount", iCreate);
          oUI.setProperty("/updateCount", iUpdate);
          oUI.setProperty("/deleteCount", iDelete);
          oUI.setProperty("/rowCountText", iVisible + " lines");
        },

        /** Map request status string → SAP UI5 ObjectStatus state */
        _statusToState: function (sStatus) {
          switch ((sStatus || "").toUpperCase()) {
            case "DRAFT": return "Warning";
            case "SUBMITTED": return "Information";
            case "APPROVED": return "Success";
            case "REJECTED": return "Error";
            case "PROMOTED": return "Success";
            default: return "None";
          }
        },

        onClearFilters: function () {
          this.getView().getModel("filter").setData({
            EnvId: "", PlantId: "", MatGroup: "", Search: "",
          });
          this.byId("searchField").setValue("");
          this._applyBaseFilter();
          MessageToast.show("Filters cleared");
        },

        // ── Value helps (dual-purpose: filter panel + table cell) ─────────

        _setCellValue: function (sValue) {
          if (!this._oCellCtx) return;
          this._oCellCtx.getModel().setProperty(
            this._oCellCtx.getPath() + "/" + this._sCellField,
            sValue
          );
        },

        onValueHelpEnv: function (oEvent) {
          this._oCellCtx = oEvent.getSource().getBindingContext("tableData") || null;
          this._sCellField = "EnvId";
          if (!this._oEnvDialog) {
            this._oEnvDialog = new SelectDialog({
              title: "Select Environment",
              liveChange: function (oEv) {
                const sVal = oEv.getParameter("value");
                oEv.getSource().getBinding("items").filter([new Filter("EnvId", FilterOperator.Contains, sVal)]);
              },
              search: function (oEv) {
                const sVal = oEv.getParameter("value");
                oEv.getSource().getBinding("items").filter([new Filter("EnvId", FilterOperator.Contains, sVal)]);
              },
              confirm: (oEv) => {
                const oItem = oEv.getParameter("selectedItem");
                if (!oItem) return;
                if (this._oCellCtx) {
                  this._setCellValue(oItem.getTitle());
                } else {
                  this.getView().getModel("filter").setProperty("/EnvId", oItem.getTitle());
                }
              },
            });
            this._oEnvDialog.bindAggregation("items", {
              path: "vh>/EnvDef",
              template: new StandardListItem({ title: "{vh>EnvId}", description: "{vh>Description}" }),
            });
            this.getView().addDependent(this._oEnvDialog);
          }
          this._oEnvDialog.open();
        },

        onValueHelpPlant: function (oEvent) {
          this._oCellCtx = oEvent.getSource().getBindingContext("tableData") || null;
          this._sCellField = "PlantId";
          if (!this._oPlantDialog) {
            this._oPlantDialog = new SelectDialog({
              title: "Select Plant",
              liveChange: function (oEv) {
                const sVal = oEv.getParameter("value");
                oEv.getSource().getBinding("items").filter([new Filter("PlantId", FilterOperator.Contains, sVal)]);
              },
              search: function (oEv) {
                const sVal = oEv.getParameter("value");
                oEv.getSource().getBinding("items").filter([new Filter("PlantId", FilterOperator.Contains, sVal)]);
              },
              confirm: (oEv) => {
                const oItem = oEv.getParameter("selectedItem");
                if (!oItem) return;
                if (this._oCellCtx) {
                  this._setCellValue(oItem.getTitle());
                } else {
                  this.getView().getModel("filter").setProperty("/PlantId", oItem.getTitle());
                }
              },
            });
            this._oPlantDialog.bindAggregation("items", {
              path: "vh>/PlantUnit",
              template: new StandardListItem({ title: "{vh>PlantId}", description: "{vh>Description}" }),
            });
            this.getView().addDependent(this._oPlantDialog);
          }
          this._oPlantDialog.open();
        },

        onValueHelpMatGroup: function (oEvent) {
          this._oCellCtx = oEvent.getSource().getBindingContext("tableData") || null;
          this._sCellField = "MatGroup";
          if (!this._oMatGroupDialog) {
            this._oMatGroupDialog = new SelectDialog({
              title: "Select Material Group",
              liveChange: function (oEv) {
                const sVal = oEv.getParameter("value");
                oEv.getSource().getBinding("items").filter([new Filter("MatlGrp", FilterOperator.Contains, sVal)]);
              },
              search: function (oEv) {
                const sVal = oEv.getParameter("value");
                oEv.getSource().getBinding("items").filter([new Filter("MatlGrp", FilterOperator.Contains, sVal)]);
              },
              confirm: (oEv) => {
                const oItem = oEv.getParameter("selectedItem");
                if (!oItem) return;
                if (this._oCellCtx) {
                  this._setCellValue(oItem.getTitle());
                } else {
                  this.getView().getModel("filter").setProperty("/MatGroup", oItem.getTitle());
                }
              },
            });
            this._oMatGroupDialog.bindAggregation("items", {
              path: "vh>/MatGroupVH",
              template: new StandardListItem({ title: "{vh>MatlGrp}" }),
            });
            this.getView().addDependent(this._oMatGroupDialog);
          }
          this._oMatGroupDialog.open();
        },
      }
    );
  }
);

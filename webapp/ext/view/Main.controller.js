sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/core/routing/History",
    "./ExcelImport"
  ],
  function (
    Controller,
    MessageToast,
    MessageBox,
    JSONModel,
    Filter,
    FilterOperator,
    SelectDialog,
    StandardListItem,
    History,
    ExcelImport
  ) {
    "use strict";

    return Controller.extend(
      "zgsp26.conf.mng.mmsafestock.confmngfemmsafestock.ext.view.Main",
      {
        _getUrlParams: function () {
          let sQuery = window.location.search || "";

          if (!sQuery && window.location.hash.indexOf("?") > -1) {
            sQuery = window.location.hash.substring(
              window.location.hash.indexOf("?")
            );
          }

          const oParams = new URLSearchParams(sQuery);

          return {
            ReqId: oParams.get("ReqId") || "",
            ConfId: oParams.get("ConfId") || "",
            ConfName: oParams.get("ConfName") || "",
            ModuleId: oParams.get("ModuleId") || "",
            TargetCds: oParams.get("TargetCds") || "",
            Status: oParams.get("Status") || "",
            EnvId: oParams.get("EnvId") || "DEV",
            Mode: oParams.get("Mode") || oParams.get("mode") || "",
          };
        },

        onInit: function () {
          this._oModel =
            this.getView().getModel() || this.getOwnerComponent().getModel();

          // UI state model
          this.getView().setModel(
            new JSONModel({ editMode: true, requestCreated: false, viewOnly: false }),
            "ui"
          );

          // Filter model
          this.getView().setModel(
            new JSONModel({ EnvId: "", PlantId: "", MatGroup: "" }),
            "filter"
          );

          // URL params → requestContext model
          const oRequestContext = this._getUrlParams();
          this.getView().setModel(new JSONModel(oRequestContext), "requestContext");

          // Request model (ReqId, Status, Reason)
          const bHasReqId = !!oRequestContext.ReqId;
          const sStatus = oRequestContext.Status || (bHasReqId ? "Draft" : "Not Created");
          this.getView().setModel(
            new JSONModel({
              ReqId: oRequestContext.ReqId || "",
              ReqItemId: "",
              ConfId: oRequestContext.ConfId || "",
              Status: sStatus,
              StatusState: bHasReqId ? "Information" : "None",
              Reason: "",
              Title: "",
            }),
            "request"
          );

          // Initialize table data model
          this.getView().setModel(new JSONModel({ rows: [] }), "tableData");

          if (bHasReqId) {
            const bIsDraft = sStatus.toUpperCase() === "DRAFT";
            this.getView().getModel("ui").setProperty("/requestCreated", true);
            this.getView().getModel("ui").setProperty("/editMode", bIsDraft);
            this.getView().getModel("ui").setProperty("/viewOnly", !bIsDraft);
            this._fetchRequestHeader(oRequestContext.ReqId);
            this._fetchReqItem(oRequestContext.ReqId);
            this._loadMainTable(oRequestContext.ReqId);
          } else if (oRequestContext.Mode === "VIEW") {
            this.getView().getModel("ui").setProperty("/editMode", false);
            this.getView().getModel("ui").setProperty("/viewOnly", true);
            this._loadMainTableWithOverlay(oRequestContext.EnvId || "DEV", null);
          } else {
            // Initial state without ReqId
            this.getView().getModel("ui").setProperty("/editMode", false);
          }
        },

        // ── Load Data ──────────────────────────────────────────────────

        _fetchRequestHeader: async function (sReqId) {
          try {
            const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
            const sUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H(ReqId=" + sReqId + ",EnvId='" + sEnvId + "',IsActiveEntity=true)" +
              "?$select=ReqId,ReqTitle,Reason,Status" +
              "&sap-client=" + this._getSapClient();
            const oResp = await fetch(sUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
              credentials: "include",
            });
            if (!oResp.ok) return;
            const oData = await oResp.json();
            const oModel = this.getView().getModel("request");
            oModel.setProperty("/Title", oData.ReqTitle || "");
            oModel.setProperty("/Reason", oData.Reason || "");
          } catch (e) { console.warn("_fetchRequestHeader failed", e); }
        },

        _fetchReqItem: async function (sReqId) {
          try {
            const sSapClient = this._getSapClient();
            const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
            const sUrl = `/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/ZC_CONF_REQ_H(ReqId=${sReqId},EnvId='${sEnvId}',IsActiveEntity=true)/_Items?$select=ReqItemId&$top=1&sap-client=${sSapClient}`;

            const oResp = await fetch(sUrl, { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } });
            if (!oResp.ok) return;
            const oData = await oResp.json();
            const aItems = oData.value || [];
            if (!aItems.length) return;

            this.getView().getModel("request").setProperty("/ReqItemId", aItems[0].ReqItemId || "");
          } catch (e) {
            console.warn("_fetchReqItem failed", e);
          }
        },

        _getMmSafeStockServiceUrl: function () {
          return "/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/";
        },

        _loadMainTable: async function (sReqId) {
          if (!sReqId) return;
          const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
          await this._loadMainTableWithOverlay(sEnvId, sReqId);
        },

        _loadMainTableWithOverlay: async function (sEnvId, sReqId) {
          try {
            const sBaseUrl = this._getMmSafeStockServiceUrl();
            const sClient = this._getSapClient();

            const [oMainResp, oReqResp] = await Promise.all([
              fetch(`${sBaseUrl}MMSafeStockMain?$filter=EnvId eq '${sEnvId}'&$orderby=PlantId,MatGroup&sap-client=${sClient}`, {
                headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
                credentials: "include"
              }),
              sReqId
                ? fetch(`${sBaseUrl}MMSafeStock?$filter=ReqId eq ${sReqId}&$select=ItemId,ReqId,ReqItemId,SourceItemId,ActionType,EnvId,PlantId,MatGroup,MinQty,VersionNo,ChangeNote&$top=500&sap-client=${sClient}`, {
                  headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
                  credentials: "include"
                })
                : Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) })
            ]);

            const aMain = oMainResp.ok ? (await oMainResp.json()).value || [] : [];
            const aReq = sReqId && oReqResp.ok ? (await oReqResp.json()).value || [] : [];

            console.log("[SafeStock] aMain count:", aMain.length, "aReq count:", aReq.length);

            const isNullGuid = id => !id || id === "00000000-0000-0000-0000-000000000000";
            const mapReqBySrc = {};
            aReq.forEach(r => {
              if (!isNullGuid(r.SourceItemId)) mapReqBySrc[r.SourceItemId] = r;
            });

            const aRows = aMain.map(m => {
              const r = mapReqBySrc[m.ItemId];
              if (r) {
                return {
                  ...r,
                  _state: r.ActionType === "X" ? "deleted" : "modified",
                  _reqItemId: { ReqId: r.ReqId, ReqItemId: r.ReqItemId, ItemId: r.ItemId }
                };
              }
              return {
                ...m,
                ActionType: "",
                ChangeNote: "",
                _state: "unchanged",
                _reqItemId: null
              };
            });

            // 1. Thêm các dòng "new" (không có SourceItemId hợp lệ)
            aReq.filter(r => isNullGuid(r.SourceItemId)).forEach(r => {
              aRows.push({
                ...r,
                _state: "new",
                _reqItemId: { ReqId: r.ReqId, ReqItemId: r.ReqItemId, ItemId: r.ItemId }
              });
            });

            // 2. Xử lý các dòng "deleted" (có SourceItemId nhưng không tồn tại trong Main nữa)
            const setMainIds = new Set(aMain.map(m => m.ItemId));
            aReq.filter(r => r.ActionType === "X" && !isNullGuid(r.SourceItemId) && !setMainIds.has(r.SourceItemId)).forEach(r => {
              aRows.push({
                ...r,
                _state: "deleted",
                _reqItemId: { ReqId: r.ReqId, ReqItemId: r.ReqItemId, ItemId: r.ItemId }
              });
            });

            this._aMainRows = aMain.map(m => ({ ...m }));
            this.getView().getModel("tableData").setProperty("/rows", aRows);
            this._applyBaseFilter();
          } catch (e) {
            console.error("Overlay Load failed:", e);
            MessageToast.show("Error loading data with overlay");
          }
        },

        // ── Actions ────────────────────────────────────────────────────

        onCreateRequest: async function () {
          const oView = this.getView();
          const oRequestCtx = oView.getModel("requestContext").getData();
          const oRequestModel = oView.getModel("request");
          const sReason = oRequestModel.getProperty("/Reason");
          const sTitle = oRequestModel.getProperty("/Title") || "";

          if (!sReason || !sReason.trim()) {
            MessageBox.warning("Please enter Reason before creating request.");
            return;
          }
          if (!oRequestCtx.ConfId) {
            MessageBox.error("ConfId is missing. Cannot create request.");
            return;
          }

          try {
            oView.setBusy(true);

            const sSapClient = this._getSapClient();
            const sServiceUrl = "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/?sap-client=" + sSapClient;
            const sCsrfToken = await this._fetchCsrfToken(sServiceUrl);

            if (!sCsrfToken) {
              MessageBox.error("Cannot fetch CSRF token");
              return;
            }

            const sActionUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H/com.sap.gateway.srvd.zsd_conf_req.v0001.createRequest" +
              "?sap-client=" + sSapClient;

            const oResponse = await fetch(sActionUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": sCsrfToken,
                "X-Requested-With": "XMLHttpRequest",
                Accept: "application/json",
              },
              credentials: "include",
              body: JSON.stringify({
                ConfId: oRequestCtx.ConfId,
                ModuleId: oRequestCtx.ModuleId || "MM",
                ConfName: oRequestCtx.ConfName || "Safe Stock Config",
                TargetCds: oRequestCtx.TargetCds || "ZI_MM_SAFESTOCK",
                ActionType: "U",
                TargetEnvId: oRequestCtx.EnvId || "DEV",
                Reason: sReason.trim(),
                Notes: sTitle.trim(),
              }),
            });

            if (!oResponse.ok) {
              const oErr = await oResponse.json().catch(() => ({}));
              MessageBox.error(oErr?.error?.message || "createRequest failed: " + oResponse.status);
              return;
            }

            // Lấy ReqId, EnvId mới nhất của ConfId (EnvId cần thiết để xây đúng key OData sau này)
            const sQueryUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H?$filter=ConfId eq " + oRequestCtx.ConfId +
              "&$orderby=CreatedAt desc&$top=1&$select=ReqId,EnvId,Status&sap-client=" + sSapClient;

            const oQueryResp = await fetch(sQueryUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
            });
            if (!oQueryResp.ok) throw new Error("Could not retrieve ReqId");

            const oQueryData = await oQueryResp.json();
            const aResults = oQueryData?.value || [];
            if (!aResults.length || !aResults[0].ReqId) throw new Error("ReqId not found");

            const sNewReqId = aResults[0].ReqId;
            // Luôn dùng EnvId thực tế từ DB để tránh 404 khi build key OData
            const sActualEnvId = aResults[0].EnvId || oRequestCtx.EnvId || "DEV";
            oView.getModel("requestContext").setProperty("/EnvId", sActualEnvId);

            await this._fetchReqItem(sNewReqId);

            // Apply the user's Title and Reason explicitly to override ABAP defaults
            await this._patchRequestHeader(sNewReqId, sTitle, sReason, sCsrfToken, sSapClient, sActualEnvId);

            oRequestModel.setProperty("/ReqId", sNewReqId);
            oRequestModel.setProperty("/EnvId", sActualEnvId);
            oRequestModel.setProperty("/Status", "Draft");
            oRequestModel.setProperty("/StatusState", "Information");

            oView.getModel("ui").setProperty("/requestCreated", true);
            oView.getModel("ui").setProperty("/editMode", true);

            // Fetch the populated draft items back out
            await this._loadMainTable(sNewReqId);
            MessageToast.show("Request created: " + sNewReqId);

          } catch (e) {
            console.error(e);
            MessageBox.error(e?.message || "Failed to create request.");
          } finally {
            oView.setBusy(false);
          }
        },

        onEdit: function () {
          const oUi = this.getView().getModel("ui");
          oUi.setProperty("/editMode", true);
          // Snapshot the current rows for change-detection during Save
          const aRows = this.getView().getModel("tableData").getProperty("/rows");
          aRows.forEach(r => { if (!r._state) r._state = "unchanged"; });
          // Keep a deep snapshot of Master Data rows for dirty comparison
          if (!this._aMainRows) {
            this._aMainRows = aRows.filter(r => r._state === "unchanged").map(r => ({ ...r }));
          }
          this.getView().getModel("tableData").setProperty("/rows", aRows);
        },

        onAddLine: function () {
          const aRows = this.getView().getModel("tableData").getProperty("/rows");
          const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";

          aRows.unshift({
            EnvId: sEnvId,
            PlantId: "",
            MatGroup: "",
            MinQty: 0,
            VersionNo: 0,
            ChangeNote: "",
            ActionType: "C",
            _state: "new"
          });
          this.getView().getModel("tableData").setProperty("/rows", aRows);
          this._applyBaseFilter();
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
          var result = ExcelImport.parseWorkbook(workbook, sEnvId);

          if (result.errors.length && !result.rows.length) {
            MessageBox.error(result.errors.join("\n"));
            return;
          }

          if (result.rows.length > 500) {
            var that = this;
            MessageBox.confirm(
              "The file contains " + result.rows.length + " rows. This may take a moment. Continue?",
              {
                onClose: function (sAction) {
                  if (sAction === "OK") { that._insertImportedRows(result); }
                }
              }
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
          if (result.skipped > 0) {
            sMsg += "\n" + result.skipped + " row(s) skipped (empty).";
          }
          MessageToast.show(sMsg);
        },

        /* ── End Import from Excel ─────────────────────────── */

        onDeleteLine: function () {
          const oTable = this.byId("safeStockTable");
          const aSelected = oTable.getSelectedContexts();
          if (!aSelected.length) {
            MessageToast.show("Please select at least one line.");
            return;
          }

          aSelected.forEach((oCtx) => {
            const oRow = oCtx.getObject();
            if (oRow._state === "new") {
              oRow._state = "discard";
            } else {
              oRow._state = "deleted";
              oRow.ActionType = "X";
            }
          });

          // Xóa các dòng 'discard' khỏi UI
          let aRows = this.getView().getModel("tableData").getProperty("/rows");
          aRows = aRows.filter(r => r._state !== "discard");
          this.getView().getModel("tableData").setProperty("/rows", aRows);

          oTable.removeSelections(true);
          this._applyBaseFilter();
          MessageToast.show(`${aSelected.length} line(s) marked for deletion.`);
        },

        onCancel: async function () {
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
          this.getView().getModel("ui").setProperty("/editMode", false);
          this._aMainRows = null; // reset snapshot so next onEdit re-captures it
          if (sReqId) {
            await this._loadMainTableWithOverlay(sEnvId, sReqId);
          }
          MessageToast.show("Changes discarded");
        },

        // ── Draft Choreography ─────────────────────────────────────────

        _fetchCsrfToken: async function (sServiceUrl) {
          const oResp = await fetch(sServiceUrl, {
            method: "GET",
            headers: { "X-CSRF-Token": "Fetch", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          });
          return oResp.ok ? oResp.headers.get("X-CSRF-Token") : null;
        },

        _postAndActivateReqRow: async function (sReqId, sReqItemId, sConfId, oPayload, sCsrfToken, sSapClient) {
          const sBase = `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/`;

          // 1. Create Draft
          const oPostBody = {
            ReqId: sReqId, ReqItemId: sReqItemId, ConfId: sConfId,
            EnvId: oPayload.EnvId, PlantId: oPayload.PlantId, MatGroup: oPayload.MatGroup,
            MinQty: oPayload.MinQty, ActionType: oPayload.ActionType,
            ChangeNote: oPayload.ChangeNote || ""
          };
          // Only send SourceItemId when set (backend rejects empty UUID string)
          if (oPayload.SourceItemId) oPostBody.SourceItemId = oPayload.SourceItemId;
          // Send OldXxx fields from FE snapshot (matches Route Config pattern)
          if (oPayload.OldEnvId !== undefined) oPostBody.OldEnvId = oPayload.OldEnvId;
          if (oPayload.OldPlantId !== undefined) oPostBody.OldPlantId = oPayload.OldPlantId;
          if (oPayload.OldMatGroup !== undefined) oPostBody.OldMatGroup = oPayload.OldMatGroup;
          if (oPayload.OldMinQty !== undefined) oPostBody.OldMinQty = oPayload.OldMinQty;
          if (oPayload.OldVersionNo !== undefined) oPostBody.OldVersionNo = oPayload.OldVersionNo;

          const oPostResp = await fetch(sBase + `MMSafeStock?sap-client=${sSapClient}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
            body: JSON.stringify(oPostBody)
          });
          if (!oPostResp.ok) throw new Error("Failed to create draft row: " + (await oPostResp.text()));
          const oCreated = await oPostResp.json();

          // 2. Activate Draft
          const sActivateUrl = `${sBase}MMSafeStock(ReqId=${oCreated.ReqId},ReqItemId=${oCreated.ReqItemId},ItemId=${oCreated.ItemId},IsActiveEntity=false)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Activate?sap-client=${sSapClient}`;
          const oActResp = await fetch(sActivateUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: "{}" });
          if (!oActResp.ok) throw new Error("Failed to activate created draft: " + (await oActResp.text()));
          return oCreated;
        },

        _editPatchActivateReqRow: async function (oKeys, oPayload, sCsrfToken, sSapClient) {
          const sBase = `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/`;
          const sKeyPath = `ReqId=${oKeys.ReqId},ReqItemId=${oKeys.ReqItemId},ItemId=${oKeys.ItemId}`;

          // Try to PATCH the draft directly (IsActiveEntity=false) - this handles rows
          // that were created inside a draft request and never had an active entity.
          const sPatchDraftUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=false)?sap-client=${sSapClient}`;
          const oPatchDraftResp = await fetch(sPatchDraftUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
            body: JSON.stringify(oPayload)
          });

          if (oPatchDraftResp.ok) {
            // Draft still exists — just activate it
            const sActivateUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=false)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Activate?sap-client=${sSapClient}`;
            const oActResp = await fetch(sActivateUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: "{}" });
            if (!oActResp.ok) throw new Error("Failed to activate draft row: " + (await oActResp.text()));
            return;
          }

          // Fallback: active entity exists → create draft via Edit, then PATCH + Activate
          const sEditUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=true)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Edit?sap-client=${sSapClient}`;
          const oEditResp = await fetch(sEditUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: JSON.stringify({ PreserveChanges: true }) });
          if (!oEditResp.ok) throw new Error("Failed to start Edit on row: " + (await oEditResp.text()));

          const sPatchUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=false)?sap-client=${sSapClient}`;
          const oPatchResp = await fetch(sPatchUrl, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: JSON.stringify(oPayload) });
          if (!oPatchResp.ok) throw new Error("Failed to UPDATE draft row: " + (await oPatchResp.text()));

          const sActivateUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=false)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Activate?sap-client=${sSapClient}`;
          const oActResp = await fetch(sActivateUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: "{}" });
          if (!oActResp.ok) throw new Error("Failed to activate updated draft: " + (await oActResp.text()));
        },


        // ── Save & Submit ──────────────────────────────────────────────

        _validateRows: function (aRows) {
          const aErrors = [];
          const aRequired = [
            { field: "PlantId", label: "Plant" },
            { field: "MatGroup", label: "Material Group" }
          ];
          aRows.forEach((row, idx) => {
            // Reset cũ
            Object.keys(row).forEach(k => { if (k.startsWith("_vs_")) row[k] = "None"; });
            if (row._state === "deleted") return;
            const sLabel = "Row " + (idx + 1);
            aRequired.forEach(({ field, label }) => {
              if (!String(row[field] || "").trim()) {
                row["_vs_" + field] = "Error";
                aErrors.push(sLabel + ": " + label + " is required.");
              }
            });
            if (!row.MinQty || row.MinQty <= 0) {
              row["_vs_MinQty"] = "Error";
              aErrors.push(sLabel + ": Min Quantity must be greater than 0.");
            }
          });
          return aErrors;
        },

        onSave: async function () {
          const oView = this.getView();
          const sReqId = oView.getModel("request").getProperty("/ReqId");
          const sReqItemId = oView.getModel("request").getProperty("/ReqItemId");
          const sConfId = oView.getModel("request").getProperty("/ConfId");
          const sTitle = oView.getModel("request").getProperty("/Title");
          const sReason = oView.getModel("request").getProperty("/Reason");
          if (!sReqId) return;

          const oTableModel = oView.getModel("tableData");
          const aRows = oTableModel.getProperty("/rows");

          // 1. Validate
          const aErrors = this._validateRows(aRows);
          oTableModel.setProperty("/rows", aRows); // re-render valueState changes
          if (aErrors.length) {
            MessageBox.error("Please fix the following errors:\n" + aErrors.join("\n"));
            return;
          }

          try {
            oView.setBusy(true);
            const sSapClient = this._getSapClient();
            const sCsrfToken = await this._fetchCsrfToken(
              `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/?sap-client=${sSapClient}`
            );
            if (!sCsrfToken) throw new Error("Missing CSRF token");

            // Build map of original master data for dirty comparison
            const oMainMap = {};
            (this._aMainRows || []).forEach(m => { oMainMap[m.ItemId] = m; });

            let iSaved = 0;

            for (const row of aRows) {
              // 2a. Brand-new line (added via Add Line)
              if (row._state === "new") {
                const oPayload = {
                  EnvId: row.EnvId || "",
                  PlantId: row.PlantId || "",
                  MatGroup: row.MatGroup || "",
                  MinQty: parseInt(row.MinQty, 10) || 0,
                  ActionType: "C",
                  ChangeNote: row.ChangeNote || ""
                };
                const oCreated = await this._postAndActivateReqRow(sReqId, sReqItemId, sConfId, oPayload, sCsrfToken, sSapClient);
                if (oCreated?.ItemId) {
                  row._reqItemId = { ReqId: oCreated.ReqId, ReqItemId: oCreated.ReqItemId, ItemId: oCreated.ItemId };
                  row._state = "new";
                  row.ActionType = "C";
                }
                iSaved++;
                continue;
              }

              // 2b. Marked deleted
              if (row._state === "deleted") {
                if (!row._reqItemId) {
                  // Chưa có draft row – tạo mới với ActionType X
                  const oOrig = oMainMap[row.ItemId] || row;
                  await this._postAndActivateReqRow(sReqId, sReqItemId, sConfId, {
                    SourceItemId: row.ItemId,
                    EnvId: row.EnvId || "", PlantId: row.PlantId || "",
                    MatGroup: row.MatGroup || "", MinQty: parseInt(row.MinQty, 10) || 0,
                    VersionNo: oOrig.VersionNo || 0,
                    ActionType: "X", ChangeNote: row.ChangeNote || "",
                    OldEnvId: oOrig.EnvId || "",
                    OldPlantId: oOrig.PlantId || "",
                    OldMatGroup: oOrig.MatGroup || "",
                    OldMinQty: parseInt(oOrig.MinQty, 10) || 0,
                    OldVersionNo: oOrig.VersionNo || 0
                  }, sCsrfToken, sSapClient);
                } else {
                  await this._editPatchActivateReqRow(row._reqItemId, { ActionType: "X" }, sCsrfToken, sSapClient);
                }
                iSaved++;
                continue;
              }

              // 2c. Unchanged / untracked – check dirty
              if (!row.ItemId) continue;
              const oOrig = oMainMap[row.ItemId];
              if (!oOrig) continue;
              const bDirty =
                String(row.PlantId || "") !== String(oOrig.PlantId || "") ||
                String(row.MatGroup || "") !== String(oOrig.MatGroup || "") ||
                String(row.MinQty || 0) !== String(oOrig.MinQty || 0) ||
                String(row.ChangeNote || "").trim() !== String(oOrig.ChangeNote || "").trim();

              if (!bDirty) continue;

              const oPayload = {
                PlantId: row.PlantId || "",
                MatGroup: row.MatGroup || "",
                MinQty: parseInt(row.MinQty, 10) || 0,
                ChangeNote: row.ChangeNote || "",
                ActionType: "U"
              };

              if (!row._reqItemId) {
                // First edit on this master row – CREATE draft, send OldXxx from snapshot
                const oCreated = await this._postAndActivateReqRow(sReqId, sReqItemId, sConfId, {
                  ...oPayload,
                  SourceItemId: row.ItemId,
                  EnvId: row.EnvId || "",
                  VersionNo: oOrig.VersionNo || 0,
                  OldEnvId: oOrig.EnvId || "",
                  OldPlantId: oOrig.PlantId || "",
                  OldMatGroup: oOrig.MatGroup || "",
                  OldMinQty: parseInt(oOrig.MinQty, 10) || 0,
                  OldVersionNo: oOrig.VersionNo || 0
                }, sCsrfToken, sSapClient);
                if (oCreated?.ItemId) {
                  row._reqItemId = { ReqId: oCreated.ReqId, ReqItemId: oCreated.ReqItemId, ItemId: oCreated.ItemId };
                  row._state = "modified";
                  row.ActionType = "U";
                }
              } else {
                // Already has a draft – PATCH it
                await this._editPatchActivateReqRow(row._reqItemId, oPayload, sCsrfToken, sSapClient);
                row._state = "modified";
              }
              iSaved++;
            }

            // 3. Patch request header (title / reason)
            const sEnvId = oView.getModel("requestContext").getProperty("/EnvId") || "DEV";
            await this._patchRequestHeader(sReqId, sTitle, sReason, sCsrfToken, sSapClient, sEnvId);

            // 4. Reload with overlay & exit edit mode
            await this._loadMainTableWithOverlay(sEnvId, sReqId);
            oView.getModel("ui").setProperty("/editMode", false);
            MessageToast.show(iSaved > 0 ? iSaved + " change(s) saved." : "No changes detected.");
          } catch (e) {
            console.error(e);
            MessageBox.error(e.message || "Save failed");
          } finally {
            oView.setBusy(false);
          }
        },

        onSubmitRequest: function () {
          const oRequestModel = this.getView().getModel("request");
          const sReqId = oRequestModel.getProperty("/ReqId");
          const sStatus = oRequestModel.getProperty("/Status") || "";

          if (!sReqId) {
            MessageBox.warning("Request has not been created yet.");
            return;
          }

          if (sStatus && sStatus.toUpperCase() !== "DRAFT") {
            MessageBox.warning("Only DRAFT requests can be submitted. Current status: " + sStatus);
            return;
          }

          MessageBox.confirm("Submit this request for approval?", {
            onClose: async (sAction) => {
              if (sAction !== "OK") return;

              const oView = this.getView();
              try {
                oView.setBusy(true);

                const sSapClient = this._getSapClient();
                const sServiceUrl = "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/?sap-client=" + sSapClient;
                const sCsrfToken = await this._fetchCsrfToken(sServiceUrl);
                if (!sCsrfToken) { MessageBox.error("Cannot fetch CSRF token"); return; }

                // Patch title/reason vào request header trước khi submit
                const sEnvId = oRequestModel.getProperty("/EnvId")
                  || this.getView().getModel("requestContext").getProperty("/EnvId")
                  || "DEV";
                const sTitle = oRequestModel.getProperty("/Title") || "";
                const sReason = oRequestModel.getProperty("/Reason") || "";
                await this._patchRequestHeader(sReqId, sTitle, sReason, sCsrfToken, sSapClient, sEnvId);

                // Gọi bound action submit trên backend
                const sActionUrl =
                  "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
                  "ZC_CONF_REQ_H(ReqId=" + sReqId + ",EnvId='" + sEnvId + "',IsActiveEntity=true)/" +
                  "com.sap.gateway.srvd.zsd_conf_req.v0001.submit" +
                  "?sap-client=" + sSapClient;

                const oResponse = await fetch(sActionUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": sCsrfToken,
                    "X-Requested-With": "XMLHttpRequest",
                    Accept: "application/json",
                  },
                  credentials: "include",
                  body: JSON.stringify({}),
                });

                if (!oResponse.ok) {
                  const oErr = await oResponse.json().catch(() => ({}));
                  const aDetails = oErr?.error?.details;
                  const sMsg = (Array.isArray(aDetails) && aDetails.length)
                    ? aDetails.map(d => d.message).join("\n")
                    : (oErr?.error?.message || "Submit failed: " + oResponse.status);
                  MessageBox.error(sMsg);
                  return;
                }

                oRequestModel.setProperty("/Status", "SUBMITTED");
                oRequestModel.setProperty("/StatusState", "Success");
                oView.getModel("ui").setProperty("/editMode", false);

                const sConfName = oView.getModel("requestContext").getProperty("/ConfName") || "Configuration";
                MessageBox.success(
                  "Request \"" + (sTitle || sReqId) + "\" has been submitted for approval.\n\n" +
                  "Your manager will review the proposed changes to \"" + sConfName + "\" and approve or reject them.",
                  {
                    title: "Request Submitted Successfully",
                    actions: [MessageBox.Action.OK],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function () { window.history.back(); },
                  }
                );
              } catch (e) {
                console.error(e);
                MessageBox.error(e?.message || "Submit failed");
              } finally {
                oView.setBusy(false);
              }
            },
          });
        },

        _patchRequestHeader: async function (sReqId, sTitle, sReason, sCsrfToken, sSapClient, sEnvId) {
          if (!sReqId) return;
          const sEnv = sEnvId || "DEV";
          const sBase = "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/";
          const sClient = "?sap-client=" + (sSapClient || this._getSapClient());
          const sKeyActive = `ZC_CONF_REQ_H(ReqId=${sReqId},EnvId='${sEnv}',IsActiveEntity=true)`;
          const sKeyDraft = `ZC_CONF_REQ_H(ReqId=${sReqId},EnvId='${sEnv}',IsActiveEntity=false)`;
          const oHdr = { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
          const oBody = { ReqTitle: sTitle || "", Reason: sReason || "" };

          // Try patching the draft directly first.
          // This handles cases where a draft already exists (e.g. from a previous edit).
          const oPatchDraftResp = await fetch(sBase + sKeyDraft + sClient, {
            method: "PATCH", headers: oHdr, credentials: "include",
            body: JSON.stringify(oBody)
          });

          if (oPatchDraftResp.ok) {
            // Activate the draft
            const oActResp = await fetch(sBase + sKeyDraft + "/com.sap.gateway.srvd.zsd_conf_req.v0001.Activate" + sClient, {
              method: "POST", headers: oHdr, credentials: "include", body: "{}"
            });
            if (!oActResp.ok) console.warn("Header Activate failed:", await oActResp.text().catch(() => ""));
            return;
          }

          // Fallback: active entity exists -- create draft via Edit, then PATCH + Activate
          const oEditResp = await fetch(sBase + sKeyActive + "/com.sap.gateway.srvd.zsd_conf_req.v0001.Edit" + sClient, {
            method: "POST", headers: oHdr, credentials: "include",
            body: JSON.stringify({ PreserveChanges: false })
          });
          if (!oEditResp.ok) {
            console.warn("Header Edit step failed:", await oEditResp.text().catch(() => ""));
            return;
          }

          // PATCH draft
          const oPatchResp = await fetch(sBase + sKeyDraft + sClient, {
            method: "PATCH", headers: oHdr, credentials: "include",
            body: JSON.stringify(oBody)
          });
          if (!oPatchResp.ok) {
            console.warn("Header PATCH failed:", await oPatchResp.text().catch(() => ""));
            return;
          }

          // Activate
          const oActResp = await fetch(sBase + sKeyDraft + "/com.sap.gateway.srvd.zsd_conf_req.v0001.Activate" + sClient, {
            method: "POST", headers: oHdr, credentials: "include", body: "{}"
          });
          if (!oActResp.ok) console.warn("Header Activate failed:", await oActResp.text().catch(() => ""));
        },


        onNavBack: function () {
          const oHistory = History.getInstance();
          const sPreviousHash = oHistory.getPreviousHash();
          if (sPreviousHash !== undefined) {
            window.history.go(-1);
          } else {
            window.location.href = window.location.origin + "/fiori#Shell-home";
          }
        },

        onRefresh: async function () {
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
          this.getView().setBusy(true);
          try {
            if (sReqId) {
              await this._loadMainTableWithOverlay(sEnvId, sReqId);
            }
            this._aMainRows = null;
            MessageToast.show("Refreshed");
          } catch (e) {
            MessageBox.error("Refresh failed");
          } finally {
            this.getView().setBusy(false);
          }
        },

        _applyBaseFilter: function () {
          this.onSearch();
        },

        onSearch: function () {
          const oBinding = this.byId("safeStockTable").getBinding("items");
          if (!oBinding) return;
          const oFilterData = this.getView().getModel("filter").getData();
          const aFilters = [];

          if (oFilterData.EnvId) aFilters.push(new Filter("EnvId", FilterOperator.Contains, oFilterData.EnvId));
          if (oFilterData.PlantId) aFilters.push(new Filter("PlantId", FilterOperator.Contains, oFilterData.PlantId));
          if (oFilterData.MatGroup) aFilters.push(new Filter("MatGroup", FilterOperator.Contains, oFilterData.MatGroup));

          const sSearch = this.byId("searchField").getValue();
          if (sSearch) {
            aFilters.push(
              new Filter({
                filters: [
                  new Filter("EnvId", FilterOperator.Contains, sSearch),
                  new Filter("PlantId", FilterOperator.Contains, sSearch),
                  new Filter("MatGroup", FilterOperator.Contains, sSearch),
                ],
                and: false,
              })
            );
          }

          oBinding.filter(aFilters);
        },

        onClearFilters: function () {
          this.getView().getModel("filter").setData({ EnvId: "", PlantId: "", MatGroup: "" });
          this.byId("searchField").setValue("");
          this.onSearch();
          MessageToast.show("Filters cleared");
        },

        _getSapClient: function () {
          return new URLSearchParams(window.location.search).get("sap-client") || "324";
        },

        onValueHelpEnv: function (oEvent) {
          const oInput = oEvent.getSource();
          const oCtx = oInput.getBindingContext("tableData");
          this._oActiveEnvInput = {
            path: oCtx ? oCtx.getPath() + "/EnvId" : "/EnvId",
            model: oCtx ? "tableData" : "filter"
          };
          if (!this._oEnvDialog) {
            this._oEnvDialog = new SelectDialog({
              title: "Select Environment",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items").filter([new Filter("EnvId", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem && this._oActiveEnvInput) {
                  this.getView().getModel(this._oActiveEnvInput.model).setProperty(this._oActiveEnvInput.path, oItem.getTitle());
                }
              },
            });
            this._oEnvDialog.bindAggregation("items", {
              path: "/EnvDef",
              template: new StandardListItem({ title: "{EnvId}", description: "{EnvName}" }),
            });
            this.getView().addDependent(this._oEnvDialog);
          }
          this._oEnvDialog.open();
        },

        onValueHelpPlant: function (oEvent) {
          const oInput = oEvent.getSource();
          const oCtx = oInput.getBindingContext("tableData");
          this._oActivePlantInput = {
            path: oCtx ? oCtx.getPath() + "/PlantId" : "/PlantId",
            model: oCtx ? "tableData" : "filter"
          };
          if (!this._oPlantDialog) {
            this._oPlantDialog = new SelectDialog({
              title: "Select Plant",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items").filter([new Filter("PlantId", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem && this._oActivePlantInput) {
                  this.getView().getModel(this._oActivePlantInput.model).setProperty(this._oActivePlantInput.path, oItem.getTitle());
                }
              },
            });
            this._oPlantDialog.bindAggregation("items", {
              path: "/PlantUnit",
              template: new StandardListItem({ title: "{PlantId}", description: "{Description}" }),
            });
            this.getView().addDependent(this._oPlantDialog);
          }
          this._oPlantDialog.open();
        },

        onValueHelpMatGroup: function (oEvent) {
          const oInput = oEvent.getSource();
          const oCtx = oInput.getBindingContext("tableData");
          this._oActiveMatGrpInput = {
            path: oCtx ? oCtx.getPath() + "/MatGroup" : "/MatGroup",
            model: oCtx ? "tableData" : "filter"
          };
          if (!this._oMatGroupDialog) {
            this._oMatGroupDialog = new SelectDialog({
              title: "Select Material Group",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items").filter([new Filter("MatlGrp", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem && this._oActiveMatGrpInput) {
                  this.getView().getModel(this._oActiveMatGrpInput.model).setProperty(this._oActiveMatGrpInput.path, oItem.getTitle());
                }
              },
            });
            this._oMatGroupDialog.bindAggregation("items", {
              path: "/MatGroupVH",
              template: new StandardListItem({ title: "{MatlGrp}" }),
            });
            this.getView().addDependent(this._oMatGroupDialog);
          }
          this._oMatGroupDialog.open();
        },

      }
    );
  }
);

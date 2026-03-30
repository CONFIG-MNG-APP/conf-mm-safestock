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
    History
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
            Mode: oParams.get("Mode") || oParams.get("mode") || "",
          };
        },

        onInit: function () {
          this._oModel =
            this.getView().getModel() || this.getOwnerComponent().getModel();

          // UI state model
          this.getView().setModel(
            new JSONModel({ editMode: true, requestCreated: false }),
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
          this.getView().setModel(
            new JSONModel({
              ReqId: oRequestContext.ReqId || "",
              Status: bHasReqId ? "Draft" : "Not Created",
              StatusState: bHasReqId ? "Information" : "None",
              Reason: "",
            }),
            "request"
          );

          // Initialize table data model
          this.getView().setModel(new JSONModel({ rows: [] }), "tableData");

          if (bHasReqId) {
            this.getView().getModel("ui").setProperty("/requestCreated", true);
            this.getView().getModel("ui").setProperty("/editMode", false);
            this._loadMainTable(oRequestContext.ReqId);
          } else {
            // Initial state without ReqId
            this.getView().getModel("ui").setProperty("/editMode", false);
          }
        },

        // ── Load Data ──────────────────────────────────────────────────

        _loadMainTable: async function (sReqId) {
          try {
            const sSapClient = this._getSapClient();
            const sServiceUrl = `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/MMSafeStock?$filter=ReqId eq '${sReqId}'&$top=500&sap-client=${sSapClient}`;

            const oResp = await fetch(sServiceUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
            });
            if (!oResp.ok) throw new Error("Failed to load request data");
            const oData = await oResp.json();

            const aRows = (oData.value || []).map(r => ({
              ...r,
              _state: "unchanged",
              _reqItemId: { ReqId: r.ReqId, ReqItemId: r.ReqItemId, ItemId: r.ItemId }
            }));

            this.getView().getModel("tableData").setProperty("/rows", aRows);
            this._applyBaseFilter();
          } catch (e) {
            console.error("Load failed:", e);
            MessageToast.show("Error loading data");
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

            // Lấy ReqId mới nhất của ConfId
            const sQueryUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H?$filter=ConfId eq '" + oRequestCtx.ConfId +
              "'&$orderby=CreatedAt desc&$top=1&$select=ReqId,Status&sap-client=" + sSapClient;

            const oQueryResp = await fetch(sQueryUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
            });
            if (!oQueryResp.ok) throw new Error("Could not retrieve ReqId");

            const oQueryData = await oQueryResp.json();
            const aResults = oQueryData?.value || [];
            if (!aResults.length || !aResults[0].ReqId) throw new Error("ReqId not found");

            const sNewReqId = aResults[0].ReqId;
            oRequestModel.setProperty("/ReqId", sNewReqId);
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
          this.getView().getModel("ui").setProperty("/editMode", true);
          // Mark all items ready for potential changes
          const aRows = this.getView().getModel("tableData").getProperty("/rows");
          aRows.forEach(r => {
            if (!r._state) r._state = "unchanged";
          });
        },

        onAddLine: function () {
          const aRows = this.getView().getModel("tableData").getProperty("/rows");
          const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "";

          aRows.unshift({
            EnvId: sEnvId,
            PlantId: "",
            MatGroup: "",
            MinQty: 0,
            VersionNo: 0,
            ActionType: "C",
            _state: "new"
          });
          this.getView().getModel("tableData").setProperty("/rows", aRows);
          this._applyBaseFilter();
        },

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
          this.getView().getModel("ui").setProperty("/editMode", false);
          if (sReqId) await this._loadMainTable(sReqId);
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

        _postAndActivateReqRow: async function (sReqId, oPayload, sCsrfToken, sSapClient) {
          const sBase = `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/`;

          // 1. Create Draft
          const oPostResp = await fetch(sBase + `MMSafeStock?sap-client=${sSapClient}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
            body: JSON.stringify({
              ReqId: sReqId, EnvId: oPayload.EnvId, PlantId: oPayload.PlantId, MatGroup: oPayload.MatGroup, MinQty: oPayload.MinQty, ActionType: oPayload.ActionType
            })
          });
          if (!oPostResp.ok) throw new Error("Failed to create draft row: " + (await oPostResp.text()));
          const oCreated = await oPostResp.json();

          // 2. Activate Draft
          const sActivateUrl = `${sBase}MMSafeStock(ReqId=${oCreated.ReqId},ReqItemId=${oCreated.ReqItemId},ItemId=${oCreated.ItemId},IsActiveEntity=false)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Activate?sap-client=${sSapClient}`;
          const oActResp = await fetch(sActivateUrl, { method: "POST", headers: { "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: "{}" });
          if (!oActResp.ok) throw new Error("Failed to activate created draft: " + (await oActResp.text()));
          return oCreated;
        },

        _editPatchActivateReqRow: async function (oKeys, oPayload, sCsrfToken, sSapClient) {
          const sBase = `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/`;
          const sKeyPath = `ReqId=${oKeys.ReqId},ReqItemId=${oKeys.ReqItemId},ItemId=${oKeys.ItemId}`;

          // 1. Edit (creates draft from active)
          const sEditUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=true)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Edit?sap-client=${sSapClient}`;
          const oEditResp = await fetch(sEditUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: JSON.stringify({ PreserveChanges: true }) });
          if (!oEditResp.ok) throw new Error("Failed to start Edit on row: " + (await oEditResp.text()));

          // 2. PATCH draft
          const sPatchUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=false)?sap-client=${sSapClient}`;
          const oPatchResp = await fetch(sPatchUrl, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: JSON.stringify(oPayload) });
          if (!oPatchResp.ok) throw new Error("Failed to UPDATE draft row: " + (await oPatchResp.text()));

          // 3. Activate
          const sActivateUrl = `${sBase}MMSafeStock(${sKeyPath},IsActiveEntity=false)/com.sap.gateway.srvd.zsd_mm_safe_stock.v0001.Activate?sap-client=${sSapClient}`;
          const oActResp = await fetch(sActivateUrl, { method: "POST", headers: { "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }, body: "{}" });
          if (!oActResp.ok) throw new Error("Failed to activate updated draft: " + (await oActResp.text()));
        },

        // ── Save & Submit ──────────────────────────────────────────────

        onSave: async function () {
          const oView = this.getView();
          const sReqId = oView.getModel("request").getProperty("/ReqId");
          const sTitle = oView.getModel("request").getProperty("/Title");
          const sReason = oView.getModel("request").getProperty("/Reason");
          if (!sReqId) return;

          try {
            oView.setBusy(true);
            const sSapClient = this._getSapClient();
            const sServiceToken = `/sap/opu/odata4/sap/zui_mm_safe_stock/srvd/sap/zsd_mm_safe_stock/0001/?sap-client=${sSapClient}`;
            const sCsrfToken = await this._fetchCsrfToken(sServiceToken);
            if (!sCsrfToken) throw new Error("Missing CSRF token");

            const aRows = oView.getModel("tableData").getProperty("/rows");
            let iSaved = 0;

            for (const row of aRows) {
              const oPayload = {
                EnvId: row.EnvId || "", PlantId: row.PlantId || "", MatGroup: row.MatGroup || "",
                MinQty: parseInt(row.MinQty, 10) || 0, ActionType: row.ActionType || "U"
              };

              if (row._state === "new") {
                await this._postAndActivateReqRow(sReqId, oPayload, sCsrfToken, sSapClient);
                iSaved++;
              } else if (row._state === "deleted" || row._state === "modified" || row._state === "unchanged") {
                await this._editPatchActivateReqRow(row._reqItemId, oPayload, sCsrfToken, sSapClient);
                iSaved++;
              }
            }

            if (sReqId) await this._patchRequestHeader(sReqId, sTitle, sReason, sCsrfToken, sSapClient, null);

            await this._loadMainTable(sReqId);
            oView.getModel("ui").setProperty("/editMode", false);
            MessageToast.show("Saved to request successfully.");
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
                const sEnvId = this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
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
          const sPatchUrl =
            "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
            "ZC_CONF_REQ_H(ReqId=" + sReqId + ",EnvId='" + sEnv + "',IsActiveEntity=false)" +
            "?sap-client=" + (sSapClient || this._getSapClient());

          await fetch(sPatchUrl, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": sCsrfToken,
              "X-Requested-With": "XMLHttpRequest",
              Accept: "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              ReqTitle: sTitle || "",
              Reason: sReason || "",
            }),
          });
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

        onRefresh: function () {
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          if (sReqId) this._loadMainTable(sReqId);
          MessageToast.show("Refreshed");
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

        onValueHelpEnv: function () {
          if (!this._oEnvDialog) {
            this._oEnvDialog = new SelectDialog({
              title: "Select Environment",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items").filter([new Filter("EnvId", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem) this.getView().getModel("filter").setProperty("/EnvId", oItem.getTitle());
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

        onValueHelpPlant: function () {
          if (!this._oPlantDialog) {
            this._oPlantDialog = new SelectDialog({
              title: "Select Plant",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items").filter([new Filter("PlantId", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem) this.getView().getModel("filter").setProperty("/PlantId", oItem.getTitle());
              },
            });
            this._oPlantDialog.bindAggregation("items", {
              path: "/PlantUnit",
              template: new StandardListItem({ title: "{PlantId}", description: "{PlantName}" }),
            });
            this.getView().addDependent(this._oPlantDialog);
          }
          this._oPlantDialog.open();
        },

      }
    );
  }
);

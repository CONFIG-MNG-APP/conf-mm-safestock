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

          if (bHasReqId) {
            this.getView().getModel("ui").setProperty("/requestCreated", true);
            this.getView().getModel("ui").setProperty("/editMode", false);

            // Filter table theo ReqId từ URL
            const oTable = this.byId("safeStockTable");
            oTable.bindItems({
              path: "/MMSafeStock",
              filters: [
                new Filter("ReqId", FilterOperator.EQ, oRequestContext.ReqId),
              ],
              template: oTable.getBindingInfo("items").template,
            });
          }

          console.log("requestContext =", oRequestContext);
        },

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
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
              credentials: "include",
            });
            if (!oQueryResp.ok) { MessageBox.error("Request created but could not retrieve ReqId"); return; }

            const oQueryData = await oQueryResp.json();
            const aResults = oQueryData?.value || [];
            if (!aResults.length || !aResults[0].ReqId) {
              MessageBox.error("Request created but ReqId not found");
              return;
            }

            const sNewReqId = aResults[0].ReqId;

            oRequestModel.setProperty("/ReqId", sNewReqId);
            oRequestModel.setProperty("/Status", "Draft");
            oRequestModel.setProperty("/StatusState", "Information");

            oView.getModel("ui").setProperty("/requestCreated", true);
            oView.getModel("ui").setProperty("/editMode", true);  // Auto enter edit mode

            // Rebind table with new ReqId
            const oTable = this.byId("safeStockTable");
            oTable.bindItems({
              path: "/MMSafeStock",
              filters: [new Filter("ReqId", FilterOperator.EQ, sNewReqId)],
              template: oTable.getBindingInfo("items").template,
            });

            MessageToast.show("Request created: " + sNewReqId);
          } catch (e) {
            console.error(e);
            MessageBox.error(e?.message || "Failed to create request.");
          } finally {
            oView.setBusy(false);
          }
        },

        _getSapClient: function () {
          return new URLSearchParams(window.location.search).get("sap-client") || "324";
        },

        _fetchCsrfToken: async function (sServiceUrl) {
          const oResp = await fetch(sServiceUrl, {
            method: "GET",
            headers: { "X-CSRF-Token": "Fetch", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          });
          if (!oResp.ok) return null;
          return oResp.headers.get("X-CSRF-Token") || null;
        },

        onEdit: function () {
          this.getView().getModel("ui").setProperty("/editMode", true);
        },

        onAddLine: function () {
          const oTable = this.byId("safeStockTable");
          const oBinding = oTable.getBinding("items");
          if (!oBinding) {
            MessageToast.show("No data binding — create a request first.");
            return;
          }
          // Create a transient context on the OData model
          try {
            oBinding.create({
              EnvId: "",
              PlantId: "",
              MatGroup: "",
              MinQty: 0,
              ActionType: "C"
            });
          } catch (e) {
            // Fallback: notify user
            MessageToast.show("Add line is only supported when connected to the backend.");
            console.warn("onAddLine:", e);
          }
        },

        onDeleteLine: function () {
          const oTable = this.byId("safeStockTable");
          const aSelected = oTable.getSelectedItems();
          if (!aSelected || aSelected.length === 0) {
            MessageToast.show("Please select at least one line to delete.");
            return;
          }
          MessageBox.confirm(
            `Delete ${aSelected.length} selected line(s)?`,
            {
              onClose: (sAction) => {
                if (sAction !== "OK") return;
                aSelected.forEach((oItem) => {
                  const oCtx = oItem.getBindingContext();
                  if (oCtx) {
                    try { oCtx.delete("$auto"); } catch (e) { console.warn(e); }
                  }
                });
                oTable.removeSelections(true);
                MessageToast.show(`${aSelected.length} line(s) marked for deletion.`);
              }
            }
          );
        },

        onCancel: function () {
          const oModel =
            this.getView().getModel() || this.getOwnerComponent().getModel();
          try {
            oModel.resetChanges("$auto");
          } catch (e) {
            console.warn(e);
          }
          this.getView().getModel("ui").setProperty("/editMode", false);
          MessageToast.show("Changes discarded");
        },

        onSave: async function () {
          const oView = this.getView();
          const oModel = oView.getModel();
          oView.setBusy(true);
          try {
            await oModel.submitBatch("$auto");
            oView.getModel("ui").setProperty("/editMode", false);
            MessageToast.show("Saved successfully");
          } catch (e) {
            console.error(e);
            MessageBox.error("Save failed");
          }
          oView.setBusy(false);
        },

        onSubmitRequest: function () {
          const oRequestModel = this.getView().getModel("request");
          const sReqId = oRequestModel.getProperty("/ReqId");

          if (!sReqId) {
            MessageBox.warning("Request has not been created yet.");
            return;
          }

          MessageBox.confirm("Submit this request for approval?", {
            onClose: (sAction) => {
              if (sAction === "OK") {
                oRequestModel.setProperty("/Status", "Submitted");
                oRequestModel.setProperty("/StatusState", "Success");
                this.getView().getModel("ui").setProperty("/editMode", false);
                MessageToast.show("Request submitted");
              }
            },
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
          const oBinding = this.byId("safeStockTable").getBinding("items");
          if (oBinding) oBinding.refresh();
          MessageToast.show("Refreshed");
        },

        onSearch: function () {
          const oBinding = this.byId("safeStockTable").getBinding("items");
          const oFilterData = this.getView().getModel("filter").getData();
          const aFilters = [];

          // ReqId filter luôn giữ nếu có
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          if (sReqId) {
            aFilters.push(new Filter("ReqId", FilterOperator.EQ, sReqId));
          }

          if (oFilterData.EnvId) {
            aFilters.push(new Filter("EnvId", FilterOperator.Contains, oFilterData.EnvId));
          }
          if (oFilterData.PlantId) {
            aFilters.push(new Filter("PlantId", FilterOperator.Contains, oFilterData.PlantId));
          }
          if (oFilterData.MatGroup) {
            aFilters.push(new Filter("MatGroup", FilterOperator.Contains, oFilterData.MatGroup));
          }

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

          // Giữ lại filter ReqId khi clear
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          const aFilters = sReqId
            ? [new Filter("ReqId", FilterOperator.EQ, sReqId)]
            : [];

          const oBinding = this.byId("safeStockTable").getBinding("items");
          if (oBinding) oBinding.filter(aFilters);

          MessageToast.show("Filters cleared");
        },

        onValueHelpEnv: function () {
          if (!this._oEnvDialog) {
            this._oEnvDialog = new SelectDialog({
              title: "Select Environment",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items")
                  .filter([new Filter("EnvId", FilterOperator.Contains, sValue)]);
              },
              search: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items")
                  .filter([new Filter("EnvId", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem) {
                  this.getView().getModel("filter").setProperty("/EnvId", oItem.getTitle());
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

        onValueHelpPlant: function () {
          if (!this._oPlantDialog) {
            this._oPlantDialog = new SelectDialog({
              title: "Select Plant",
              liveChange: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items")
                  .filter([new Filter("PlantId", FilterOperator.Contains, sValue)]);
              },
              search: (oEvent) => {
                const sValue = oEvent.getParameter("value");
                oEvent.getSource().getBinding("items")
                  .filter([new Filter("PlantId", FilterOperator.Contains, sValue)]);
              },
              confirm: (oEvent) => {
                const oItem = oEvent.getParameter("selectedItem");
                if (oItem) {
                  this.getView().getModel("filter").setProperty("/PlantId", oItem.getTitle());
                }
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

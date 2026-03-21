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
  ],
  function (
    Controller,
    MessageToast,
    MessageBox,
    JSONModel,
    Filter,
    FilterOperator,
    SelectDialog,
    StandardListItem
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
            ReqId:    oParams.get("ReqId")    || "",
            ConfId:   oParams.get("ConfId")   || "",
            ConfName: oParams.get("ConfName") || "",
            ModuleId: oParams.get("ModuleId") || "",
            TargetCds: oParams.get("TargetCds") || "",
            Mode:     oParams.get("Mode") || oParams.get("mode") || "",
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
              ReqId:       oRequestContext.ReqId || "",
              Status:      bHasReqId ? "Draft" : "Not Created",
              StatusState: bHasReqId ? "Information" : "None",
              Reason:      "",
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
          const oView        = this.getView();
          const oRequestCtx  = oView.getModel("requestContext").getData();
          const oRequestModel = oView.getModel("request");
          const sReason      = oRequestModel.getProperty("/Reason");

          if (!sReason || !sReason.trim()) {
            MessageBox.warning("Please enter Reason before creating request.");
            return;
          }

          try {
            oView.setBusy(true);

            // TODO: thay bằng call backend createRequest thật
            const sReqId = "REQ-" + Date.now();

            oRequestModel.setProperty("/ReqId",       sReqId);
            oRequestModel.setProperty("/Status",      "Draft");
            oRequestModel.setProperty("/StatusState", "Information");

            oView.getModel("ui").setProperty("/requestCreated", true);
            oView.getModel("ui").setProperty("/editMode",       false);

            MessageToast.show("Request created: " + sReqId);
            console.log("Create Request with context =", oRequestCtx);
          } catch (e) {
            console.error(e);
            MessageBox.error("Failed to create request.");
          } finally {
            oView.setBusy(false);
          }
        },

        onEdit: function () {
          this.getView().getModel("ui").setProperty("/editMode", true);
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
          const oView  = this.getView();
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
                oRequestModel.setProperty("/Status",      "Submitted");
                oRequestModel.setProperty("/StatusState", "Success");
                this.getView().getModel("ui").setProperty("/editMode", false);
                MessageToast.show("Request submitted");
              }
            },
          });
        },

        onRefresh: function () {
          const oBinding = this.byId("safeStockTable").getBinding("items");
          if (oBinding) oBinding.refresh();
          MessageToast.show("Refreshed");
        },

        onSearch: function () {
          const oBinding   = this.byId("safeStockTable").getBinding("items");
          const oFilterData = this.getView().getModel("filter").getData();
          const aFilters   = [];

          // ReqId filter luôn giữ nếu có
          const sReqId = this.getView().getModel("request").getProperty("/ReqId");
          if (sReqId) {
            aFilters.push(new Filter("ReqId", FilterOperator.EQ, sReqId));
          }

          if (oFilterData.EnvId) {
            aFilters.push(new Filter("EnvId",    FilterOperator.Contains, oFilterData.EnvId));
          }
          if (oFilterData.PlantId) {
            aFilters.push(new Filter("PlantId",  FilterOperator.Contains, oFilterData.PlantId));
          }
          if (oFilterData.MatGroup) {
            aFilters.push(new Filter("MatGroup", FilterOperator.Contains, oFilterData.MatGroup));
          }

          const sSearch = this.byId("searchField").getValue();
          if (sSearch) {
            aFilters.push(
              new Filter({
                filters: [
                  new Filter("EnvId",    FilterOperator.Contains, sSearch),
                  new Filter("PlantId",  FilterOperator.Contains, sSearch),
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

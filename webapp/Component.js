sap.ui.define(
  ["sap/fe/core/AppComponent", "sap/ui/model/json/JSONModel"],
  function (AppComponent, JSONModel) {
    "use strict";

    return AppComponent.extend(
      "zgsp26.conf.mng.mmsafestock.confmngfemmsafestock.Component",
      {
        metadata: {
          manifest: "json",
        },

        init: function () {
          const oReqCtx = this._buildContextFromUrl();
          this.setModel(new JSONModel(oReqCtx), "reqCtx");
          AppComponent.prototype.init.apply(this, arguments);
        },

        _buildContextFromUrl: function () {
          const sUrl = window.location.href.split("#")[0];
          const oParams = new URL(sUrl).searchParams;

          const sReqId = oParams.get("ReqId") || "";

          return {
            ReqId:      sReqId,
            ConfName:   oParams.get("ConfName")  || "",
            ModuleId:   oParams.get("ModuleId")  || "",
            TargetCds:  oParams.get("TargetCds") || "",
            EnvId:      oParams.get("EnvId")     || "DEV",
            Reason:     oParams.get("Reason")    || "",
            hasReqId:   !!sReqId,
            status:     sReqId ? "Created" : "Not Created",
          };
        },
      }
    );
  }
);

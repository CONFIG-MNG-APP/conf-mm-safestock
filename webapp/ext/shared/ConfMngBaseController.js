sap.ui.define(
  ["sap/ui/core/mvc/Controller", "sap/m/MessageBox", "sap/m/MessageToast"],
  function (Controller, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend(
      "zgsp26.conf.mng.mmsafestock.confmngfemmsafestock.ext.shared.ConfMngBaseController",
      {
        // ── Abstract overrides — implement in each app controller ─────────

        /** @abstract SAP module ID for createRequest (e.g. "MM"). */
        _getModuleId:  function () { return ""; },
        /** @abstract Display name of the configuration catalog. */
        _getConfName:  function () { return "Configuration"; },
        /** @abstract Target CDS interface entity (e.g. "ZI_MM_SAFE_STOCK"). */
        _getTargetCds: function () { return ""; },

        // ── URL parameter extraction ──────────────────────────────────────
        _getUrlParams: function () {
          let sQuery = window.location.search || "";
          if (!sQuery && window.location.hash.indexOf("?") > -1) {
            sQuery = window.location.hash.substring(
              window.location.hash.indexOf("?")
            );
          }
          const oParams = new URLSearchParams(sQuery);
          return {
            ReqId:     oParams.get("ReqId")     || "",
            ConfId:    oParams.get("ConfId")    || "",
            ConfName:  oParams.get("ConfName")  || "",
            ModuleId:  oParams.get("ModuleId")  || "",
            TargetCds: oParams.get("TargetCds") || "",
            Status:    oParams.get("Status")    || "",
            EnvId:     oParams.get("EnvId")     || "DEV",
            Mode:      oParams.get("Mode") || oParams.get("mode") || "",
          };
        },

        // ── onEdit ───────────────────────────────────────────────────────
        onEdit: function () {
          this.getView().getModel("ui").setProperty("/editMode", true);
        },

        // ── onNavBack ────────────────────────────────────────────────────
        onNavBack: function () {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            var oParams    = this._getUrlParams();
            var sSapClient = new URLSearchParams(window.location.search).get("sap-client") || "324";
            var sMode      = localStorage.getItem("conf-mng-nav-mode") ||
              (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                ? "local" : "deploy");
            var sRequestAppUrl = sMode === "local"
              ? "http://localhost:8081/index.html"
              : window.location.origin + "/sap/bc/ui5_ui5/sap/zconf_req_ui/index.html";

            var sUrl = sRequestAppUrl +
              "?sap-client=" + sSapClient +
              (oParams.ConfId    ? "&ConfId="    + encodeURIComponent(oParams.ConfId)    : "") +
              (oParams.ConfName  ? "&ConfName="  + encodeURIComponent(oParams.ConfName)  : "") +
              (oParams.ModuleId  ? "&ModuleId="  + encodeURIComponent(oParams.ModuleId)  : "") +
              (oParams.TargetCds ? "&TargetCds=" + encodeURIComponent(oParams.TargetCds) : "") +
              (oParams.EnvId     ? "&EnvId="     + encodeURIComponent(oParams.EnvId)     : "");

            window.location.href = sUrl;
          }
        },

        // ── onCreateRequest ──────────────────────────────────────────────
        onCreateRequest: async function () {
          const oView           = this.getView();
          const oRequestContext = oView.getModel("requestContext").getData();
          const oRequestModel   = oView.getModel("request");
          const sReason         = oRequestModel.getProperty("/Reason");

          if (!sReason || !sReason.trim()) {
            MessageBox.warning("Please enter Reason before creating request.");
            return;
          }
          if (!oRequestContext.ConfId) {
            MessageBox.error("ConfId is missing. Cannot create request.");
            return;
          }

          try {
            oView.setBusy(true);

            const sSapClient = this._getSapClient();
            const sServiceUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/?sap-client=" + sSapClient;
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
                "Content-Type":     "application/json",
                "X-CSRF-Token":     sCsrfToken,
                "X-Requested-With": "XMLHttpRequest",
                Accept:             "application/json",
              },
              credentials: "include",
              body: JSON.stringify({
                ConfId:      oRequestContext.ConfId,
                ModuleId:    oRequestContext.ModuleId  || this._getModuleId(),
                ConfName:    oRequestContext.ConfName  || this._getConfName(),
                TargetCds:   oRequestContext.TargetCds || this._getTargetCds(),
                ActionType:  "U",
                TargetEnvId: oRequestContext.EnvId     || "DEV",
                Reason:      sReason.trim(),
                Notes:       "",
              }),
            });

            if (!oResponse.ok) {
              const oErr = await oResponse.json().catch(() => ({}));
              MessageBox.error(
                oErr?.error?.message || "createRequest failed: " + oResponse.status
              );
              return;
            }

            const sQueryUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H?$filter=ConfId eq " + oRequestContext.ConfId +
              "&$orderby=CreatedAt desc&$top=1&$select=ReqId,EnvId,Status&sap-client=" + sSapClient;

            const oQueryResp = await fetch(sQueryUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
              credentials: "include",
            });
            if (!oQueryResp.ok) {
              MessageBox.error("Request created but could not retrieve ReqId");
              return;
            }

            const aResults = (await oQueryResp.json()).value || [];
            if (!aResults.length || !aResults[0].ReqId) {
              MessageBox.error("Request created but ReqId not found");
              return;
            }

            const sNewReqId    = aResults[0].ReqId;
            const sActualEnvId = aResults[0].EnvId || oRequestContext.EnvId || "DEV";
            oView.getModel("requestContext").setProperty("/EnvId", sActualEnvId);

            oRequestModel.setProperty("/ReqId",       sNewReqId);
            oRequestModel.setProperty("/Status",      "Draft");
            oRequestModel.setProperty("/StatusState", "Warning");
            oView.getModel("ui").setProperty("/requestCreated", true);
            oView.getModel("ui").setProperty("/editMode",       true);

            await this._fetchReqItem(sNewReqId);
            await this._loadMainTableWithOverlay(sActualEnvId, sNewReqId);

            MessageToast.show("Request created. Edit what you need, then Save.");
          } catch (e) {
            console.error(e);
            MessageBox.error(e?.message || "Failed to create request.");
          } finally {
            oView.setBusy(false);
          }
        },

        // ── onSubmitRequest ──────────────────────────────────────────────
        onSubmitRequest: function () {
          const oRequestModel = this.getView().getModel("request");
          const sReqId  = oRequestModel.getProperty("/ReqId");
          const sStatus = oRequestModel.getProperty("/Status");

          if (!sReqId) {
            MessageBox.warning("Request has not been created yet.");
            return;
          }
          if ((sStatus || "").toUpperCase() !== "DRAFT") {
            MessageBox.warning(
              "Only DRAFT requests can be submitted. Current status: " + sStatus
            );
            return;
          }

          MessageBox.confirm("Submit this request for approval?", {
            onClose: async (sAction) => {
              if (sAction !== "OK") return;
              const oView = this.getView();
              try {
                oView.setBusy(true);
                const sSapClient = this._getSapClient();
                const sCsrfToken = await this._fetchCsrfToken(
                  "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/?sap-client=" + sSapClient
                );
                if (!sCsrfToken) {
                  MessageBox.error("Cannot fetch CSRF token");
                  return;
                }

                const sTitle  = oRequestModel.getProperty("/ReqTitle") || "";
                const sReason = oRequestModel.getProperty("/Reason")   || "";
                await this._patchRequestHeader(sReqId, sTitle, sReason);

                const sEnvId = oView.getModel("requestContext").getProperty("/EnvId") || "DEV";
                const sActionUrl =
                  "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
                  "ZC_CONF_REQ_H(ReqId=" + sReqId +
                  ",EnvId='" + sEnvId + "',IsActiveEntity=true)/" +
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

                // === Email notification (fire-and-forget) ===
                this._sendMailNotification({
                  event: "SUBMITTED",
                  reqId: sReqId,
                  reqTitle: sTitle || sReqId,
                  module: this._getModuleId() || "MM",
                  envId: sEnvId || "DEV",
                  triggeredBy: this._getCurrentUser()
                });

                oRequestModel.setProperty("/Status",      "SUBMITTED");
                oRequestModel.setProperty("/StatusState", "Success");
                oView.getModel("ui").setProperty("/editMode", false);

                const sConfName =
                  oView.getModel("requestContext").getProperty("/ConfName") || "Configuration";
                MessageBox.success(
                  'Request "' + (sTitle || sReqId) +
                    '" has been submitted for approval.\n\n' +
                    'Your manager will review the proposed changes to "' + sConfName + '" and approve or reject them.',
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

        // ── Private helpers ──────────────────────────────────────────────

        // ── Email notification (fire-and-forget) ─────────────────────────
        // Sends notification to external mail-service on Render.com.
        // Failures are silently ignored and do NOT affect app logic.
        _MAIL_SERVICE_URL: "https://abap19-mail-206.onrender.com/api/notify",
        _MAIL_SERVICE_KEY: "abap19-mail-secret-key-change-me",

        _sendMailNotification: function (oPayload) {
          try {
            fetch(this._MAIL_SERVICE_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this._MAIL_SERVICE_KEY
              },
              body: JSON.stringify(oPayload || {})
            }).catch(function () { /* silently ignore */ });
          } catch (e) { /* silently ignore */ }
        },

        /** Get current SAP user (best-effort) for triggeredBy field. */
        _getCurrentUser: function () {
          try {
            if (sap && sap.ushell && sap.ushell.Container) {
              var oService = sap.ushell.Container.getService("UserInfo");
              if (oService && oService.getUser) {
                return oService.getUser().getId() || "unknown";
              }
            }
          } catch (e) { /* ignore */ }
          return "unknown";
        },

        _getSapClient: function () {
          return new URLSearchParams(window.location.search).get("sap-client") || "324";
        },

        _fetchCsrfToken: async function (sServiceUrl) {
          const oResp = await fetch(sServiceUrl, {
            method: "GET",
            headers: {
              "X-CSRF-Token": "Fetch",
              "X-Requested-With": "XMLHttpRequest",
            },
            credentials: "include",
          });
          if (!oResp.ok) return null;
          return oResp.headers.get("X-CSRF-Token") || null;
        },

        _dbToPascal: function (sDbName) {
          return sDbName
            .toLowerCase()
            .split("_")
            .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
            .join("");
        },

        _extractODataError: function (oErr) {
          const aDetails = oErr?.error?.details;
          if (Array.isArray(aDetails) && aDetails.length > 0) {
            return aDetails.map(function (d) { return d.message; }).join("\n");
          }
          return oErr?.error?.message || "Unknown error";
        },

        _fetchFieldDef: function (sConfId) {
          const sUrl =
            "/sap/opu/odata4/sap/zui_conf_catalog/srvd/sap/zsd_conf_catalog/0001/" +
            "ConfigFieldDef?$filter=ConfId eq " + sConfId +
            "&$select=FieldName,FieldLabel,IsRequired" +
            "&sap-client=" + this._getSapClient();

          fetch(sUrl, {
            headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              this._aFieldDef = data.value || [];
              console.log("[FieldDef] Loaded", this._aFieldDef.length, "definitions for ConfId", sConfId);
            }.bind(this))
            .catch(function (e) {
              console.warn("[FieldDef] Could not load field definitions:", e);
            });
        },

        _fetchRequestHeader: async function (sReqId) {
          try {
            const sEnvId =
              this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
            const sUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H(ReqId=" + sReqId +
              ",EnvId='" + sEnvId + "',IsActiveEntity=true)" +
              "?$select=ReqId,ReqTitle,Reason,Status" +
              "&sap-client=" + this._getSapClient();
            const oResp = await fetch(sUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
              credentials: "include",
            });
            if (!oResp.ok) return;
            const oData  = await oResp.json();
            const oModel = this.getView().getModel("request");
            oModel.setProperty("/ReqTitle", oData.ReqTitle || "");
            oModel.setProperty("/Reason",   oData.Reason   || "");
          } catch (e) {
            console.warn("_fetchRequestHeader failed", e);
          }
        },

        _fetchReqItem: async function (sReqId) {
          try {
            const sEnvId =
              this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
            const sUrl =
              "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/" +
              "ZC_CONF_REQ_H(ReqId=" + sReqId +
              ",EnvId='" + sEnvId + "',IsActiveEntity=true)/_Items" +
              "?$select=ReqItemId,ConfId&$top=1&sap-client=" + this._getSapClient();
            const oResp = await fetch(sUrl, {
              headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
              credentials: "include",
            });
            if (!oResp.ok) return;
            const aItems = (await oResp.json()).value || [];
            if (!aItems.length) return;
            const oModel = this.getView().getModel("request");
            oModel.setProperty("/ReqItemId", aItems[0].ReqItemId || "");
            if (aItems[0].ConfId) oModel.setProperty("/ConfId", aItems[0].ConfId);
          } catch (e) {
            console.warn("_fetchReqItem failed", e);
          }
        },

        _patchRequestHeader: async function (sReqId, sTitle, sReason) {
          if (!sReqId) return;
          const sSapClient = this._getSapClient();
          const sEnvId =
            this.getView().getModel("requestContext").getProperty("/EnvId") || "DEV";
          const sBase    = "/sap/opu/odata4/sap/zui_conf_req/srvd/sap/zsd_conf_req/0001/";
          const sClient  = "?sap-client=" + sSapClient;
          const sKeyActive = "ZC_CONF_REQ_H(ReqId=" + sReqId + ",EnvId='" + sEnvId + "',IsActiveEntity=true)";
          const sKeyDraft  = "ZC_CONF_REQ_H(ReqId=" + sReqId + ",EnvId='" + sEnvId + "',IsActiveEntity=false)";

          const sCsrfToken = await this._fetchCsrfToken(sBase + sClient);
          if (!sCsrfToken) return;

          const oHdr  = { "Content-Type": "application/json", "X-CSRF-Token": sCsrfToken, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
          const oBody = { ReqTitle: sTitle || "", Reason: sReason || "" };

          // Try patching draft directly
          const oPatchDraftResp = await fetch(sBase + sKeyDraft + sClient, {
            method: "PATCH", headers: oHdr, credentials: "include", body: JSON.stringify(oBody),
          });
          if (oPatchDraftResp.ok) {
            const oActResp = await fetch(
              sBase + sKeyDraft + "/com.sap.gateway.srvd.zsd_conf_req.v0001.Activate" + sClient,
              { method: "POST", headers: oHdr, credentials: "include", body: "{}" }
            );
            if (!oActResp.ok) console.warn("Header Activate failed:", await oActResp.text().catch(() => ""));
            return;
          }

          // Fallback: Edit → PATCH → Activate
          const oEditResp = await fetch(
            sBase + sKeyActive + "/com.sap.gateway.srvd.zsd_conf_req.v0001.Edit" + sClient,
            { method: "POST", headers: oHdr, credentials: "include", body: JSON.stringify({ PreserveChanges: false }) }
          );
          if (!oEditResp.ok) {
            console.warn("Header Edit step failed:", await oEditResp.text().catch(() => ""));
            return;
          }

          const oPatchResp = await fetch(sBase + sKeyDraft + sClient, {
            method: "PATCH", headers: oHdr, credentials: "include", body: JSON.stringify(oBody),
          });
          if (!oPatchResp.ok) {
            console.warn("Header PATCH failed:", await oPatchResp.text().catch(() => ""));
            return;
          }

          const oActResp = await fetch(
            sBase + sKeyDraft + "/com.sap.gateway.srvd.zsd_conf_req.v0001.Activate" + sClient,
            { method: "POST", headers: oHdr, credentials: "include", body: "{}" }
          );
          if (!oActResp.ok) console.warn("Header Activate failed:", await oActResp.text().catch(() => ""));
        },
      }
    );
  }
);

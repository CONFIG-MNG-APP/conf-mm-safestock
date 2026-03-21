sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"zgsp26/conf/mng/mmsafestock/confmngfemmsafestock/test/integration/pages/MMSafeStockMain"
], function (JourneyRunner, MMSafeStockMain) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('zgsp26/conf/mng/mmsafestock/confmngfemmsafestock') + '/test/flp.html#app-preview',
        pages: {
			onTheMMSafeStockMain: MMSafeStockMain
        },
        async: true
    });

    return runner;
});


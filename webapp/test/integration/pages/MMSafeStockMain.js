sap.ui.define(['sap/fe/test/TemplatePage'], function(TemplatePage) {
    'use strict';

    var CustomPageDefinitions = {
        actions: {},
        assertions: {}
    };

    return new TemplatePage(
        'zgsp26.conf.mng.mmsafestock.confmngfemmsafestock::MMSafeStockMain',
        CustomPageDefinitions
    );
});
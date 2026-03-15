import { getConfig, saveConfig, type AppConfigV1 } from "../config/appConfig";
import { getMetaConfig, saveMetaConfig, type MetaConfigV1 } from "../config/metaConfig";
import { getPricingConfig, savePricingConfig, type PricingConfigV1 } from "../config/pricingConfig";
import { getServiceCatalog, saveServiceCatalog, type ServiceCatalogV1 } from "../config/serviceCatalog";
import { getAllVendorKeys, replaceVendorKeys, type VendorKeysV1 } from "../config/vendorKeys";
import { listMetaOrders, replaceMetaOrders, type MetaOrder } from "./metaOrdersStore";
import { listOrders, replaceOrders, type DemoOrder } from "./ordersStore";

export type DemoSnapshotV1 = {
  version: 1;
  exportedAt: string;
  includesSecrets: boolean;
  appConfig: AppConfigV1;
  pricingConfig: PricingConfigV1;
  serviceCatalog: ServiceCatalogV1;
  orders: DemoOrder[];
  metaOrders: MetaOrder[];
  vendorKeys?: VendorKeysV1;
  metaConfig?: MetaConfigV1;
};

function isoNow() {
  return new Date().toISOString();
}

export function createDemoSnapshot(options?: { includeSecrets?: boolean }): DemoSnapshotV1 {
  const includeSecrets = !!options?.includeSecrets;
  return {
    version: 1,
    exportedAt: isoNow(),
    includesSecrets,
    appConfig: getConfig(),
    pricingConfig: getPricingConfig(),
    serviceCatalog: getServiceCatalog(),
    orders: listOrders(),
    metaOrders: listMetaOrders(),
    ...(includeSecrets
      ? {
          vendorKeys: getAllVendorKeys(),
          metaConfig: getMetaConfig(),
        }
      : {}),
  };
}

export function parseDemoSnapshot(json: string): { ok: true; snapshot: DemoSnapshotV1 } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(json) as Partial<DemoSnapshotV1>;
    if (!parsed || parsed.version !== 1) {
      return { ok: false, message: "備份檔版本不支援。" };
    }
    if (
      !parsed.appConfig ||
      !parsed.pricingConfig ||
      !parsed.serviceCatalog ||
      !Array.isArray(parsed.orders) ||
      !Array.isArray(parsed.metaOrders)
    ) {
      return { ok: false, message: "備份檔內容不完整。" };
    }
    return {
      ok: true,
      snapshot: {
        version: 1,
        exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : isoNow(),
        includesSecrets: parsed.includesSecrets === true,
        appConfig: parsed.appConfig,
        pricingConfig: parsed.pricingConfig,
        serviceCatalog: parsed.serviceCatalog,
        orders: parsed.orders as DemoOrder[],
        metaOrders: parsed.metaOrders as MetaOrder[],
        vendorKeys: parsed.vendorKeys,
        metaConfig: parsed.metaConfig,
      },
    };
  } catch {
    return { ok: false, message: "備份檔不是有效的 JSON。" };
  }
}

export function restoreDemoSnapshot(snapshot: DemoSnapshotV1) {
  saveConfig(snapshot.appConfig);
  savePricingConfig(snapshot.pricingConfig);
  saveServiceCatalog(snapshot.serviceCatalog);
  replaceOrders(snapshot.orders);
  replaceMetaOrders(snapshot.metaOrders);
  if (snapshot.includesSecrets && snapshot.vendorKeys) {
    replaceVendorKeys(snapshot.vendorKeys);
  }
  if (snapshot.includesSecrets && snapshot.metaConfig) {
    saveMetaConfig(snapshot.metaConfig);
  }
}

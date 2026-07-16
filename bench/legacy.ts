import { createRequire } from "node:module";
import { join } from "node:path";
import type { ExpectedAddress } from "./dataset";

interface LegacyModule {
  split(raw: string): {
    name?: unknown;
    phone?: unknown;
    address?: unknown;
    subdistrict?: unknown;
    district?: unknown;
    province?: unknown;
    zipcode?: unknown;
  };
}

function output(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function loadLegacyParser(projectPath: string): (raw: string) => ExpectedAddress {
  const require = createRequire(import.meta.url);
  const legacy = require(join(projectPath, "src", "index.js")) as LegacyModule;
  return (raw: string): ExpectedAddress => {
    const result = legacy.split(raw);
    return {
      name: output(result.name),
      phone: output(result.phone),
      address: output(result.address),
      subdistrict: output(result.subdistrict),
      district: output(result.district),
      province: output(result.province),
      zipcode: output(result.zipcode),
    };
  };
}

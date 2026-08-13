import { describe, expect, it } from "vitest";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";

describe("identificadores de dominio", () => {
  it("formatea y parsea IDs sin confiar en texto del cliente", () => {
    expect(formatEntityId("T", 101, 3)).toBe("T101");
    expect(parseEntityId("T101", "T")).toBe(101);
    expect(parseEntityId("EABC", "E")).toBeNull();
    expect(parseEntityId("V01", "T")).toBeNull();
    expect(formatEntityId("A", 2)).toBe("A002");
    expect(parseEntityId("A002", "A")).toBe(2);
  });
});

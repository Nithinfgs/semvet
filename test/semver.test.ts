import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { declaredBump, maxBump, parseVersion, satisfies } from "../src/semver.js";

const v = (s: string) => {
  const p = parseVersion(s);
  assert.ok(p, `could not parse ${s}`);
  return p;
};

describe("semver helpers", () => {
  it("parses versions, prereleases and build metadata", () => {
    assert.equal(v("1.2.3").minor, 2);
    assert.equal(v("v1.2.3-beta.1+build5").prerelease, "beta.1");
    assert.equal(parseVersion("latest"), undefined);
    assert.equal(parseVersion(undefined), undefined);
  });

  it("computes the declared bump", () => {
    assert.equal(declaredBump(v("1.2.3"), v("2.0.0")), "major");
    assert.equal(declaredBump(v("1.2.3"), v("1.3.0")), "minor");
    assert.equal(declaredBump(v("1.2.3"), v("1.2.4")), "patch");
    assert.equal(declaredBump(v("1.2.3"), v("1.2.3")), "none");
    assert.equal(declaredBump(v("2.0.0"), v("1.9.0")), "none");
  });

  it("checks that a bump covers the required level", () => {
    assert.equal(satisfies(v("1.0.0"), v("1.1.0"), "major"), false);
    assert.equal(satisfies(v("1.0.0"), v("2.0.0"), "major"), true);
    assert.equal(satisfies(v("1.0.0"), v("1.1.0"), "minor"), true);
    assert.equal(satisfies(v("1.0.0"), v("1.0.1"), "minor"), false);
    assert.equal(satisfies(v("1.0.0"), v("1.0.1"), "none"), true);
  });

  it("shifts expectations down below 1.0.0", () => {
    assert.equal(satisfies(v("0.3.0"), v("0.4.0"), "major"), true);
    assert.equal(satisfies(v("0.3.0"), v("0.3.1"), "major"), false);
    assert.equal(satisfies(v("0.3.0"), v("0.3.1"), "minor"), true);
  });

  it("picks the larger bump", () => {
    assert.equal(maxBump("patch", "minor"), "minor");
    assert.equal(maxBump("major", "none"), "major");
  });
});

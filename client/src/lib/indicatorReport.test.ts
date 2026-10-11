import { describe, expect, it } from "vitest";
import { buildIndicatorRankings, type ReportIndicator } from "./indicatorReport";

function indicator(criterionCode: string, score: number): ReportIndicator {
  return { criterionCode, criterionName: `المؤشر ${criterionCode}`, domainName: "المجال", score };
}

describe("buildIndicatorRankings", () => {
  it("returns the five highest scores in descending order", () => {
    const input = [indicator("1", 81), indicator("2", 92), indicator("3", 67), indicator("4", 99), indicator("5", 90), indicator("6", 80)];

    expect(buildIndicatorRankings(input).topFive.map(item => item.score)).toEqual([99, 92, 90, 81, 80]);
  });

  it("lists all below-excellence indicators from lowest to highest and excludes 90%", () => {
    const input = [indicator("1", 89.99), indicator("2", 75), indicator("3", 90), indicator("4", 49.5)];

    expect(buildIndicatorRankings(input).belowExcellence.map(item => item.score)).toEqual([49.5, 75, 89.99]);
  });

  it("uses the criterion code to make ties deterministic and does not mutate the input", () => {
    const input = [indicator("1-10", 88), indicator("1-2", 88)];
    const original = [...input];

    expect(buildIndicatorRankings(input).belowExcellence.map(item => item.criterionCode)).toEqual(["1-2", "1-10"]);
    expect(input).toEqual(original);
  });

  it("handles an empty indicator list", () => {
    expect(buildIndicatorRankings([])).toEqual({ topFive: [], belowExcellence: [] });
  });
});

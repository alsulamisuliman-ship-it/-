export type ReportIndicator = {
  criterionCode: string;
  criterionName: string;
  domainName: string;
  score: number;
};

export type IndicatorRankings<T extends ReportIndicator> = {
  topFive: T[];
  belowExcellence: T[];
};

function compareCode(a: ReportIndicator, b: ReportIndicator) {
  return a.criterionCode.localeCompare(b.criterionCode, "ar", { numeric: true });
}

export function buildIndicatorRankings<T extends ReportIndicator>(indicators: readonly T[]): IndicatorRankings<T> {
  const highestFirst = [...indicators].sort((a, b) => b.score - a.score || compareCode(a, b));
  const belowExcellence = indicators
    .filter(indicator => indicator.score < 90)
    .slice()
    .sort((a, b) => a.score - b.score || compareCode(a, b));

  return {
    topFive: highestFirst.slice(0, 5),
    belowExcellence,
  };
}

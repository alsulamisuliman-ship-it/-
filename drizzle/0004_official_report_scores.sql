CREATE TABLE `evaluationReportDomains` (
	`id` varchar(24) NOT NULL,
	`reportId` varchar(24) NOT NULL,
	`domainName` varchar(240) NOT NULL,
	`score` decimal(5,2) NOT NULL,
	`scoreEvidence` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evaluationReportDomains_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `evaluationReports` ADD `overallScoreEvidence` text;
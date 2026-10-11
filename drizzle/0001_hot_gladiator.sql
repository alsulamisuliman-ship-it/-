CREATE TABLE `evaluationCriteria` (
	`id` varchar(24) NOT NULL,
	`reportId` varchar(24) NOT NULL,
	`domainName` varchar(240) NOT NULL,
	`criterionCode` varchar(80) NOT NULL,
	`criterionName` text NOT NULL,
	`score` decimal(5,2) NOT NULL,
	`classification` enum('strength','weakness') NOT NULL,
	`priority` enum('low','medium','high','critical') NOT NULL,
	`evidence` text NOT NULL,
	`treatment` text NOT NULL,
	`treatmentSource` enum('extracted','suggested') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evaluationCriteria_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evaluationReports` (
	`id` varchar(24) NOT NULL,
	`ownerId` int NOT NULL,
	`schoolId` varchar(24) NOT NULL,
	`fileName` varchar(300) NOT NULL,
	`fileKey` varchar(600) NOT NULL,
	`fileUrl` varchar(900) NOT NULL,
	`status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
	`errorMessage` text,
	`overallScore` decimal(5,2),
	`analyzedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evaluationReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schools` (
	`id` varchar(24) NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(240) NOT NULL,
	`educationOffice` varchar(240),
	`city` varchar(120),
	`stage` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schools_id` PRIMARY KEY(`id`)
);

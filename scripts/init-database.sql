-- Run once in a NEW, EMPTY MySQL-compatible database. Does not drop existing tables.
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

CREATE TABLE `evaluationReportDomains` (
	`id` varchar(24) NOT NULL,
	`reportId` varchar(24) NOT NULL,
	`domainName` varchar(240) NOT NULL,
	`score` decimal(5,2) NOT NULL,
	`scoreEvidence` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evaluationReportDomains_id` PRIMARY KEY(`id`)
);

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
	`overallScoreEvidence` text,
	`analyzedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evaluationReports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `improvementPlans` (
	`id` varchar(24) NOT NULL,
	`ownerId` int NOT NULL,
	`reportId` varchar(24) NOT NULL,
	`criterionId` varchar(24) NOT NULL,
	`targetScore` decimal(5,2) NOT NULL,
	`needDescription` text NOT NULL,
	`improvementActions` text NOT NULL,
	`implementationMechanism` text NOT NULL,
	`startDate` varchar(10),
	`endDate` varchar(10),
	`responsibleName` varchar(240),
	`status` enum('planned','in_progress','completed') NOT NULL DEFAULT 'planned',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `improvementPlans_id` PRIMARY KEY(`id`),
	CONSTRAINT `improvementPlans_criterionId_unique` UNIQUE(`criterionId`)
);

CREATE TABLE `portalSessions` (
	`tokenHash` varchar(64) NOT NULL,
	`role` enum('supervisor','school') NOT NULL,
	`schoolAccountId` varchar(24),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portalSessions_tokenHash` PRIMARY KEY(`tokenHash`)
);

CREATE TABLE `reportFileChunks` (
	`fileKey` varchar(512) NOT NULL,
	`chunkIndex` int NOT NULL,
	`content` mediumblob NOT NULL,
	CONSTRAINT `reportFileChunks_fileKey_chunkIndex_pk` PRIMARY KEY(`fileKey`,`chunkIndex`)
);

CREATE TABLE `schoolPortalAccounts` (
	`id` varchar(24) NOT NULL,
	`ownerId` int NOT NULL,
	`schoolId` varchar(24) NOT NULL,
	`principalName` varchar(240) NOT NULL,
	`mobile` varchar(24) NOT NULL,
	`username` varchar(80) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`status` enum('pending','active','suspended') NOT NULL DEFAULT 'pending',
	`activatedAt` timestamp,
	`activatedBy` varchar(24),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schoolPortalAccounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `schoolPortalAccounts_ownerId_unique` UNIQUE(`ownerId`),
	CONSTRAINT `schoolPortalAccounts_schoolId_unique` UNIQUE(`schoolId`),
	CONSTRAINT `schoolPortalAccounts_username_unique` UNIQUE(`username`)
);

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

CREATE TABLE `uploadRateLimits` (
	`bucketKey` varchar(64) NOT NULL,
	`windowStart` int NOT NULL,
	`requestCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `uploadRateLimits_bucketKey` PRIMARY KEY(`bucketKey`)
);

CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);


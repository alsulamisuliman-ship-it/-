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

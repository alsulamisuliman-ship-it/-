CREATE TABLE `portalSessions` (
	`tokenHash` varchar(64) NOT NULL,
	`role` enum('supervisor','school') NOT NULL,
	`schoolAccountId` varchar(24),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portalSessions_tokenHash` PRIMARY KEY(`tokenHash`)
);
--> statement-breakpoint
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

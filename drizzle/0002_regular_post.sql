CREATE TABLE `uploadRateLimits` (
	`bucketKey` varchar(64) NOT NULL,
	`windowStart` int NOT NULL,
	`requestCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `uploadRateLimits_bucketKey` PRIMARY KEY(`bucketKey`)
);

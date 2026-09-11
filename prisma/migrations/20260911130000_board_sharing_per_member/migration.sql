-- Board documents now always reach the board by naming each member, so the
-- choice between that and the Google Group is gone, and with it the org-wide
-- "can the group edit" toggle — edit access is a property of the document.
--
-- `groupEmail` stays: it is still the address the board is written to, and a
-- sharing sweep needs it to take the old group permission back off files.
ALTER TABLE "OrgConfig" DROP COLUMN "shareMode";
ALTER TABLE "OrgConfig" DROP COLUMN "groupCanEdit";

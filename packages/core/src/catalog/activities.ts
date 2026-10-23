/**
 * Activity catalog: friendly names and descriptions for operations.
 *
 * Three layers, merged at load time (later layers win):
 *   1. activities.seed.json — generated from the Management Activity API schema markdown.
 *   2. CURATED below — the operations analysts meet most often, with investigation-oriented wording.
 *   3. activities.learn.json (optional, produced by scripts/refresh-catalog.ts, which scrapes
 *      https://learn.microsoft.com/en-us/purview/audit-log-activities).
 *
 * The catalog never gates ingestion: operations that are not in it are stored, indexed and shown
 * with their raw name, and surfaced in Data Coverage & Health as "discovered, not in catalog".
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { WorkloadGroup } from './workloads.js';

export interface ActivityDefinition {
  operation: string;
  friendlyName: string;
  description: string;
  group: WorkloadGroup;
  source: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', 'data');

type C = [op: string, friendly: string, description: string, group: WorkloadGroup];
const CURATED: C[] = [
  // Entra sign-in (STS logon)
  ['UserLoggedIn', 'Signed in', 'A user signed in to Entra ID successfully.', 'identity'],
  ['UserLoginFailed', 'Sign-in failed', 'A sign-in attempt failed; the LogonError / ErrorCode says why (wrong password, MFA required, blocked by policy…).', 'identity'],
  ['UserLoggedOff', 'Signed out', 'A user signed out.', 'identity'],
  // Entra directory
  ['Add user.', 'User created', 'A user account was created in the directory.', 'identity'],
  ['Delete user.', 'User deleted', 'A user account was deleted.', 'identity'],
  ['Restore user.', 'User restored', 'A deleted user was restored.', 'identity'],
  ['Update user.', 'User updated', 'User properties changed (watch StrongAuthentication / SecurityInfo changes).', 'identity'],
  ['Reset user password.', 'Password reset by admin', 'An administrator reset a user\'s password.', 'identity'],
  ['Change user password.', 'Password changed', 'A user changed their own password.', 'identity'],
  ['Set force change user password.', 'Password change forced', 'The user must change password at next sign-in.', 'identity'],
  ['Update user credentials.', 'Credentials updated', 'User credentials were updated.', 'identity'],
  ['Add member to role.', 'Added to admin role', 'A user, group or service principal was added to a directory role.', 'identity'],
  ['Remove member from role.', 'Removed from admin role', 'A member was removed from a directory role.', 'identity'],
  ['Add eligible member to role.', 'Made eligible for role (PIM)', 'A PIM eligible assignment was created.', 'identity'],
  ['Add scoped member to role.', 'Added to scoped role', 'A role assignment scoped to an administrative unit was created.', 'identity'],
  ['Add member to group.', 'Added to group', 'A member was added to a group.', 'identity'],
  ['Remove member from group.', 'Removed from group', 'A member was removed from a group.', 'identity'],
  ['Add group.', 'Group created', 'A group was created.', 'identity'],
  ['Delete group.', 'Group deleted', 'A group was deleted.', 'identity'],
  ['Update group.', 'Group updated', 'Group properties changed.', 'identity'],
  ['Add owner to group.', 'Group owner added', 'An owner was added to a group.', 'identity'],
  ['Add application.', 'App registration created', 'An application was registered.', 'identity'],
  ['Update application.', 'App registration updated', 'Application properties changed.', 'identity'],
  ['Delete application.', 'App registration deleted', 'An application registration was deleted.', 'identity'],
  ['Update application – Certificates and secrets management ', 'App credentials changed', 'A client secret or certificate was added to or removed from an app registration.', 'identity'],
  ['Add service principal.', 'Enterprise app added', 'A service principal (enterprise application) was created in the tenant.', 'identity'],
  ['Add service principal credentials.', 'Service principal credentials added', 'A secret or certificate was added to a service principal.', 'identity'],
  ['Remove service principal credentials.', 'Service principal credentials removed', 'A credential was removed from a service principal.', 'identity'],
  ['Add owner to application.', 'App owner added', 'An owner was added to an application.', 'identity'],
  ['Add owner to service principal.', 'Service principal owner added', 'An owner was added to a service principal.', 'identity'],
  ['Consent to application.', 'Consent granted to app', 'A user or admin consented to an application\'s requested permissions. Check the scopes and IsAdminConsent.', 'identity'],
  ['Add OAuth2PermissionGrant.', 'Delegated permission grant added', 'Delegated permissions were granted to an application.', 'identity'],
  ['Add delegated permission grant.', 'Delegated permission grant added', 'Delegated permissions were granted to an application.', 'identity'],
  ['Add app role assignment to service principal.', 'App permission assigned', 'An application permission (app role) was assigned to a service principal.', 'identity'],
  ['Add app role assignment grant to user.', 'User assigned to app', 'A user was assigned to an application.', 'identity'],
  ['Add policy.', 'Policy added', 'A directory policy was created.', 'identity'],
  ['Update policy.', 'Policy updated', 'A directory policy was changed.', 'identity'],
  ['Delete policy.', 'Policy deleted', 'A directory policy was deleted.', 'identity'],
  ['Update conditional access policy.', 'Conditional Access policy updated', 'A Conditional Access policy changed.', 'identity'],
  ['Add conditional access policy.', 'Conditional Access policy added', 'A Conditional Access policy was created.', 'identity'],
  ['Delete conditional access policy.', 'Conditional Access policy deleted', 'A Conditional Access policy was deleted.', 'identity'],
  ['Set domain authentication.', 'Domain authentication changed', 'Federation / managed authentication setting of a domain changed. High impact.', 'identity'],
  ['Set federation settings on domain.', 'Domain federation settings changed', 'Federation settings changed — classic persistence technique.', 'identity'],
  ['Add domain to company.', 'Domain added', 'A domain was added to the tenant.', 'identity'],
  ['Verify domain.', 'Domain verified', 'A domain was verified.', 'identity'],
  ['Disable Strong Authentication.', 'MFA disabled', 'Per-user MFA was disabled.', 'identity'],
  ['Update authorization policy.', 'Authorization policy updated', 'Tenant authorization policy changed (user consent, guest access…).', 'identity'],
  ['Set company information.', 'Company information changed', 'Tenant-level settings changed.', 'identity'],
  ['User registered security info', 'Sign-in method registered', 'The user registered an MFA / SSPR method.', 'identity'],
  ['User deleted security info', 'Sign-in method removed', 'The user removed an MFA / SSPR method.', 'identity'],
  ['User changed default security info', 'Default sign-in method changed', 'The user changed their default MFA method.', 'identity'],
  ['User registered all required security info', 'Security info registration completed', 'The user completed registration of all required methods.', 'identity'],
  ['User started security info registration', 'Security info registration started', 'The user started registering methods.', 'identity'],
  ['Admin registered security info', 'Admin registered sign-in method', 'An administrator registered an MFA method for a user.', 'identity'],
  ['Admin deleted security info', 'Admin removed sign-in method', 'An administrator removed an MFA method from a user.', 'identity'],
  ['Admin updated security info', 'Admin updated sign-in method', 'An administrator updated a user\'s MFA method.', 'identity'],
  ['Reset password (self-service)', 'Self-service password reset', 'The user reset their password through SSPR.', 'identity'],
  // Exchange mailbox
  ['MailItemsAccessed', 'Mailbox items accessed', 'Mail was read or synced. MailAccessType Bind = individual messages, Sync = whole folder sync. OperationCount gives the real volume; IsThrottled means more happened than was logged.', 'exchange'],
  ['Send', 'Email sent', 'A message was sent from the mailbox.', 'exchange'],
  ['SendAs', 'Email sent as another user', 'A message was sent using Send As permission.', 'exchange'],
  ['SendOnBehalf', 'Email sent on behalf', 'A message was sent using Send on Behalf permission.', 'exchange'],
  ['MailboxLogin', 'Mailbox signed in', 'A mailbox logon (legacy / POP / IMAP / delegate).', 'exchange'],
  ['Create', 'Mailbox item created', 'An item (message, contact, appointment) was created.', 'exchange'],
  ['Update', 'Mailbox item updated', 'An item\'s properties were changed.', 'exchange'],
  ['Move', 'Mailbox items moved', 'Items were moved to another folder.', 'exchange'],
  ['MoveToDeletedItems', 'Moved to Deleted Items', 'Items were deleted (moved to Deleted Items).', 'exchange'],
  ['SoftDelete', 'Soft deleted', 'Items were deleted from Deleted Items (recoverable).', 'exchange'],
  ['HardDelete', 'Hard deleted', 'Items were purged from Recoverable Items.', 'exchange'],
  ['Copy', 'Mailbox items copied', 'Items were copied.', 'exchange'],
  ['FolderBind', 'Folder accessed', 'A mailbox folder was opened.', 'exchange'],
  ['UpdateInboxRules', 'Inbox rules changed (client)', 'Inbox rules were changed from an Outlook client; details are in the raw record, not in Parameters.', 'exchange'],
  ['UpdateFolderPermissions', 'Folder permissions changed', 'Folder-level permissions were changed.', 'exchange'],
  ['UpdateCalendarDelegation', 'Calendar delegation changed', 'Calendar delegate settings changed.', 'exchange'],
  ['AddFolderPermissions', 'Folder permissions added', 'Permissions were added to a folder.', 'exchange'],
  ['SearchQueryInitiatedExchange', 'Mailbox search', 'The user searched their mailbox; the query text is in QueryText.', 'exchange'],
  ['SearchQueryInitiatedSharePoint', 'SharePoint search', 'The user searched SharePoint; the query text is recorded.', 'sharepoint'],
  // Exchange admin cmdlets
  ['New-InboxRule', 'Inbox rule created', 'An inbox rule was created (Parameters hold ForwardTo, DeleteMessage, MoveToFolder…).', 'exchange'],
  ['Set-InboxRule', 'Inbox rule changed', 'An inbox rule was modified.', 'exchange'],
  ['Enable-InboxRule', 'Inbox rule enabled', 'An inbox rule was enabled.', 'exchange'],
  ['Disable-InboxRule', 'Inbox rule disabled', 'An inbox rule was disabled.', 'exchange'],
  ['Remove-InboxRule', 'Inbox rule removed', 'An inbox rule was deleted.', 'exchange'],
  ['Set-Mailbox', 'Mailbox settings changed', 'Mailbox properties changed — check ForwardingSmtpAddress / ForwardingAddress / DeliverToMailboxAndForward.', 'exchange'],
  ['Add-MailboxPermission', 'Mailbox permission granted', 'Full Access or similar rights were granted on a mailbox.', 'exchange'],
  ['Remove-MailboxPermission', 'Mailbox permission removed', 'Mailbox rights were removed.', 'exchange'],
  ['Add-RecipientPermission', 'Send As granted', 'Send As permission was granted.', 'exchange'],
  ['Add-MailboxFolderPermission', 'Folder permission granted', 'Folder-level permission was granted.', 'exchange'],
  ['Set-MailboxFolderPermission', 'Folder permission changed', 'Folder-level permission was changed.', 'exchange'],
  ['New-TransportRule', 'Mail flow rule created', 'A transport rule was created — check RedirectMessageTo / BlindCopyTo.', 'exchange'],
  ['Set-TransportRule', 'Mail flow rule changed', 'A transport rule was modified.', 'exchange'],
  ['Remove-TransportRule', 'Mail flow rule removed', 'A transport rule was deleted.', 'exchange'],
  ['New-InboundConnector', 'Inbound connector created', 'A mail connector was created.', 'exchange'],
  ['Set-InboundConnector', 'Inbound connector changed', 'A mail connector was modified.', 'exchange'],
  ['Set-OrganizationConfig', 'Exchange organization config changed', 'Tenant-wide Exchange settings changed (includes audit settings).', 'exchange'],
  ['Set-AdminAuditLogConfig', 'Admin audit logging changed', 'Audit logging configuration changed. High impact.', 'purview'],
  ['Set-MailboxAuditBypassAssociation', 'Mailbox audit bypass set', 'An account was configured to bypass mailbox auditing.', 'purview'],
  ['New-ManagementRoleAssignment', 'Exchange role assigned', 'An Exchange RBAC role was assigned.', 'exchange'],
  ['Add-RoleGroupMember', 'Added to Exchange role group', 'A member was added to a role group.', 'exchange'],
  ['Search-Mailbox', 'Mailbox searched / purged', 'A mailbox search, possibly with -DeleteContent.', 'purview'],
  ['New-ComplianceSearch', 'Content search created', 'A compliance search was created.', 'purview'],
  ['New-ComplianceSearchAction', 'Content search action', 'Export, preview or purge of a content search.', 'purview'],
  ['SearchExported', 'Search results exported', 'eDiscovery search results were exported.', 'purview'],
  ['SearchExportDownloaded', 'Search export downloaded', 'An eDiscovery export was downloaded.', 'purview'],
  ['New-DistributionGroup', 'Distribution group created', 'A distribution group was created.', 'exchange'],
  ['Add-DistributionGroupMember', 'Added to distribution group', 'A member was added to a distribution group.', 'exchange'],
  ['Set-CASMailbox', 'Client access settings changed', 'Mailbox protocol settings changed (POP/IMAP/ActiveSync/EWS).', 'exchange'],
  ['New-Mailbox', 'Mailbox created', 'A mailbox was created.', 'exchange'],
  ['Remove-Mailbox', 'Mailbox removed', 'A mailbox was removed.', 'exchange'],
  // SharePoint / OneDrive — the most common ones get investigation wording (the seed covers the rest)
  ['FileAccessed', 'File viewed or opened', 'A file was opened or downloaded by an app on the user\'s behalf.', 'sharepoint'],
  ['FileAccessedExtended', 'File access continued', 'Continuation of FileAccessed within the same session (logged in 2-hour windows).', 'sharepoint'],
  ['FileDownloaded', 'File downloaded', 'A file was downloaded to a device.', 'sharepoint'],
  ['FileUploaded', 'File uploaded', 'A file was uploaded.', 'sharepoint'],
  ['FileModified', 'File modified', 'A file was changed.', 'sharepoint'],
  ['FileModifiedExtended', 'File modification continued', 'Continuation of FileModified within the same session.', 'sharepoint'],
  ['FileDeleted', 'File deleted', 'A file was deleted.', 'sharepoint'],
  ['FileRecycled', 'File moved to recycle bin', 'A file was moved to the recycle bin.', 'sharepoint'],
  ['FileDeletedFirstStageRecycleBin', 'Deleted from recycle bin', 'A file was deleted from the first-stage recycle bin.', 'sharepoint'],
  ['FileDeletedSecondStageRecycleBin', 'Deleted from second-stage recycle bin', 'A file was permanently deleted.', 'sharepoint'],
  ['FileMoved', 'File moved', 'A file was moved.', 'sharepoint'],
  ['FileCopied', 'File copied', 'A file was copied.', 'sharepoint'],
  ['FileRenamed', 'File renamed', 'A file was renamed.', 'sharepoint'],
  ['FileRestored', 'File restored', 'A file was restored from the recycle bin.', 'sharepoint'],
  ['FilePreviewed', 'File previewed', 'A file preview was rendered.', 'sharepoint'],
  ['FileSyncDownloadedFull', 'File synced down', 'A file was downloaded by the OneDrive sync client.', 'onedrive'],
  ['FileSyncUploadedFull', 'File synced up', 'A file was uploaded by the OneDrive sync client.', 'onedrive'],
  ['FileSyncDownloadedPartial', 'File partially synced down', 'A changed part of a file was downloaded by the sync client.', 'onedrive'],
  ['FileCheckedOut', 'File checked out', 'A file was checked out.', 'sharepoint'],
  ['FileCheckedIn', 'File checked in', 'A file was checked in.', 'sharepoint'],
  ['FolderCreated', 'Folder created', 'A folder was created.', 'sharepoint'],
  ['FolderDeleted', 'Folder deleted', 'A folder was deleted.', 'sharepoint'],
  ['FolderRecycled', 'Folder moved to recycle bin', 'A folder was moved to the recycle bin.', 'sharepoint'],
  ['PageViewed', 'Page viewed', 'A SharePoint page was viewed.', 'sharepoint'],
  ['PageViewedExtended', 'Page view continued', 'Continuation of PageViewed.', 'sharepoint'],
  ['SharingSet', 'Sharing permission set', 'A sharing permission was set on an item.', 'sharepoint'],
  ['SharingInvitationCreated', 'Sharing invitation sent', 'An item was shared with a specific person.', 'sharepoint'],
  ['SharingInvitationAccepted', 'Sharing invitation accepted', 'The recipient accepted a sharing invitation.', 'sharepoint'],
  ['SharingLinkCreated', 'Sharing link created', 'A sharing link was created.', 'sharepoint'],
  ['SharingLinkUsed', 'Sharing link used', 'Someone used a sharing link.', 'sharepoint'],
  ['AnonymousLinkCreated', '"Anyone" link created', 'An anonymous (anyone with the link) sharing link was created.', 'sharepoint'],
  ['AnonymousLinkUpdated', '"Anyone" link updated', 'An anonymous link was changed.', 'sharepoint'],
  ['AnonymousLinkUsed', '"Anyone" link used', 'Someone used an anonymous link.', 'sharepoint'],
  ['AnonymousLinkRemoved', '"Anyone" link removed', 'An anonymous link was removed.', 'sharepoint'],
  ['CompanyLinkCreated', 'Organisation link created', 'A "people in the organisation" link was created.', 'sharepoint'],
  ['SecureLinkCreated', 'Specific-people link created', 'A "specific people" link was created.', 'sharepoint'],
  ['AddedToSecureLink', 'Added to specific-people link', 'A person was added to a specific-people link.', 'sharepoint'],
  ['SecureLinkUsed', 'Specific-people link used', 'A specific-people link was used.', 'sharepoint'],
  ['SiteCollectionCreated', 'Site collection created', 'A site collection was created.', 'sharepoint'],
  ['SiteDeleted', 'Site deleted', 'A site was deleted.', 'sharepoint'],
  ['SiteCollectionAdminAdded', 'Site collection admin added', 'A site collection administrator was added.', 'sharepoint'],
  ['PermissionLevelAdded', 'Permission level added', 'A permission level was added.', 'sharepoint'],
  ['AddedToGroup', 'Added to SharePoint group', 'A user was added to a site group.', 'sharepoint'],
  ['ListItemViewed', 'List item viewed', 'A list item was viewed.', 'sharepoint'],
  ['ListViewed', 'List viewed', 'A list was viewed.', 'sharepoint'],
  // Teams
  ['TeamCreated', 'Team created', 'A team was created.', 'teams'],
  ['TeamDeleted', 'Team deleted', 'A team was deleted.', 'teams'],
  ['MemberAdded', 'Member added to team', 'Members were added to a team.', 'teams'],
  ['MemberRemoved', 'Member removed from team', 'Members were removed from a team.', 'teams'],
  ['MemberRoleChanged', 'Team member role changed', 'A member was made owner or demoted.', 'teams'],
  ['ChannelAdded', 'Channel created', 'A channel was created.', 'teams'],
  ['ChannelDeleted', 'Channel deleted', 'A channel was deleted.', 'teams'],
  ['MessageSent', 'Teams message sent', 'A chat or channel message was sent.', 'teams'],
  ['MessageRead', 'Teams message read', 'A message was read.', 'teams'],
  ['MessagesListed', 'Teams messages listed', 'Messages were retrieved in bulk (export or app).', 'teams'],
  ['MessageHostedContentsListed', 'Message attachments listed', 'Hosted content of messages was listed.', 'teams'],
  ['ChatCreated', 'Chat created', 'A chat was created.', 'teams'],
  ['ChatRetrieved', 'Chat retrieved', 'A chat was retrieved by an app.', 'teams'],
  ['TeamsSessionStarted', 'Teams session started', 'The user signed in to Teams.', 'teams'],
  ['AppInstalled', 'Teams app installed', 'An app was installed in Teams.', 'teams'],
  ['TeamSettingChanged', 'Team setting changed', 'A team setting was changed.', 'teams'],
  ['TeamsTenantSettingChanged', 'Teams tenant setting changed', 'A tenant-wide Teams setting was changed.', 'teams'],
  ['MeetingDetail', 'Meeting detail', 'Meeting start, end and join URL.', 'teams'],
  ['MeetingParticipantDetail', 'Meeting participant', 'A participant joined or left a meeting.', 'teams'],
  // Copilot
  ['CopilotInteraction', 'Copilot interaction', 'A user prompted Copilot; AccessedResources lists what Copilot read.', 'copilot'],
  // Purview / DLP / labels
  ['DlpRuleMatch', 'DLP rule matched', 'Content matched a DLP policy rule.', 'purview'],
  ['DlpRuleUndo', 'DLP action undone', 'A DLP action was overridden or undone.', 'purview'],
  ['DlpInfo', 'DLP info', 'DLP informational event (false positive report).', 'purview'],
  ['SensitivityLabelApplied', 'Sensitivity label applied', 'A sensitivity label was applied.', 'purview'],
  ['SensitivityLabelRemoved', 'Sensitivity label removed', 'A sensitivity label was removed.', 'purview'],
  ['SensitivityLabelUpdated', 'Sensitivity label changed', 'A sensitivity label was changed.', 'purview'],
  ['AlertTriggered', 'Alert triggered', 'A security & compliance alert fired.', 'security'],
  ['AlertEntityGenerated', 'Alert entity generated', 'An entity was attached to an alert.', 'security'],
  ['TIMailData', 'Threat intelligence: email', 'Defender for Office 365 verdict on a message.', 'security'],
  ['TIUrlClickData', 'Safe Links click', 'A Safe Links URL click recorded in the audit log.', 'security'],
  ['QuarantineRequestReleaseMessage', 'Quarantined message released', 'A message was released from quarantine.', 'security'],
  ['QuarantinePreviewMessage', 'Quarantined message previewed', 'A quarantined message was previewed.', 'security'],
  // Synthesised by the importer for Layer B sources
  ['EmailDelivery', 'Email delivered / traced', 'One recipient\'s delivery outcome from message trace or Defender EmailEvents.', 'exchange'],
  ['LinkClicked', 'Safe Links click', 'A user clicked a URL protected by Safe Links (UrlClickEvents).', 'security'],
  ['EmailUrlInfo', 'Link in email', 'A URL found in a message body, subject or attachment.', 'security'],
  ['EmailAttachment', 'Email attachment', 'An attachment in a message with its hash and verdict.', 'security'],
  ['Phish ZAP', 'Zero-hour auto purge (phish)', 'Defender removed an already-delivered phishing message.', 'security'],
  ['Malware ZAP', 'Zero-hour auto purge (malware)', 'Defender removed an already-delivered malware message.', 'security'],
  ['Manual remediation', 'Manual remediation', 'An analyst moved or deleted a delivered message.', 'security'],
  // Power Platform
  ['CreateFlow', 'Flow created', 'A Power Automate flow was created.', 'powerplatform'],
  ['EditFlow', 'Flow edited', 'A Power Automate flow was edited.', 'powerplatform'],
  ['DeleteFlow', 'Flow deleted', 'A Power Automate flow was deleted.', 'powerplatform'],
  ['ExportReport', 'Power BI report exported', 'A Power BI report was exported.', 'powerplatform'],
  ['ViewReport', 'Power BI report viewed', 'A Power BI report was viewed.', 'powerplatform'],
  ['ShareReport', 'Power BI report shared', 'A Power BI report was shared.', 'powerplatform'],
];

let merged: Map<string, ActivityDefinition> | null = null;

export function normalizeOperationKey(op: string): string {
  return op.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim();
}

function load(): Map<string, ActivityDefinition> {
  if (merged) return merged;
  const m = new Map<string, ActivityDefinition>();
  const put = (a: ActivityDefinition) => m.set(normalizeOperationKey(a.operation), a);
  try {
    const seed = JSON.parse(readFileSync(join(dataDir, 'activities.seed.json'), 'utf8')) as { activities: ActivityDefinition[] };
    seed.activities.forEach(put);
  } catch { /* seed missing: curated only */ }
  for (const [operation, friendlyName, description, group] of CURATED) put({ operation, friendlyName, description, group, source: 'curated' });
  const learn = join(dataDir, 'activities.learn.json');
  if (existsSync(learn)) {
    try {
      const l = JSON.parse(readFileSync(learn, 'utf8')) as { activities: ActivityDefinition[] };
      for (const a of l.activities) {
        const k = normalizeOperationKey(a.operation);
        const cur = m.get(k);
        // Keep curated investigation wording, but accept Learn's friendly name when we have none.
        if (!cur || cur.source !== 'curated') m.set(k, a);
      }
    } catch { /* ignore malformed refresh output */ }
  }
  merged = m;
  return m;
}

export function activityFor(operation: string | null | undefined): ActivityDefinition | null {
  if (!operation) return null;
  return load().get(normalizeOperationKey(operation)) ?? null;
}

export function friendlyOperation(operation: string): string {
  return activityFor(operation)?.friendlyName ?? operation;
}

export function allActivities(): ActivityDefinition[] {
  return [...load().values()];
}

export function catalogSize(): number { return load().size; }

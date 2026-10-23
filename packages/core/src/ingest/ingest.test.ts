import { describe as suite, it, expect } from 'vitest';
import { detectFormat, createNormalizer, toIso } from './index.js';
import { recordTypeName, resolveRecordType } from '../catalog/record-types.js';
import { parseQuery } from '../query/parse.js';
import { countryOf, ownerOf, cleanIp } from '@audit/ipdata';

suite('timestamps', () => {
  it('parses the shapes Microsoft exports use', () => {
    expect(toIso('2025-01-31T09:12:44.0000000Z')).toBe('2025-01-31T09:12:44.000Z');
    expect(toIso('2025-01-31T09:12:44')).toBe('2025-01-31T09:12:44.000Z');
    expect(toIso('1/31/2025 9:12:44 AM')).toBe('2025-01-31T09:12:44.000Z');
    expect(toIso('31-01-2025 09:12:44')).toBe('2025-01-31T09:12:44.000Z');
    expect(toIso('')).toBeNull();
  });
});

suite('record types', () => {
  it('knows the full enum', () => {
    expect(recordTypeName(14)).toBe('SharePointSharingOperation');
    expect(recordTypeName(261)).toBe('CopilotInteraction');
    expect(resolveRecordType('ExchangeItem')).toEqual({ id: 2, name: 'ExchangeItem' });
    expect(resolveRecordType('Viva Engage')).toEqual({ id: 22, name: 'Yammer' });
    expect(resolveRecordType(999)).toEqual({ id: 999, name: null });
  });
});

suite('detection + normalisation', () => {
  it('handles a new-portal Purview export with an inbox rule', () => {
    const ad = {
      Id: 'abc-1', RecordType: 1, CreationTime: '2026-03-02T07:15:00', Operation: 'New-InboxRule', OrganizationId: 'o', UserType: 0, UserKey: 'k',
      Workload: 'Exchange', ResultStatus: 'True', ObjectId: 'contoso.onmicrosoft.com/Users/Anna', UserId: 'Anna@Contoso.com', ClientIP: '[2001:db8::5]:443',
      Parameters: [{ Name: 'Identity', Value: 'anna' }, { Name: 'ForwardTo', Value: 'evil@gmail.com' }, { Name: 'Name', Value: '.' }],
    };
    const row = { RecordId: 'abc-1', CreationDate: '2026-03-02T07:15:00.0000000Z', RecordType: 'ExchangeAdmin', Operation: 'New-InboxRule', UserId: 'Anna@Contoso.com', AuditData: JSON.stringify(ad), AssociatedAdminUnits: '' };
    const f = detectFormat([row]);
    expect(f.source).toBe('purview');
    const [e] = createNormalizer(f)(row);
    expect(e.sourceRecordId).toBe('abc-1');
    expect(e.userUpn).toBe('anna@contoso.com');
    expect(e.kind).toBe('admin');
    expect(e.clientIp).toBe('2001:db8::5');
    expect(e.result).toBe('Succeeded');
    expect(e.detail).toContain('ForwardTo=evil@gmail.com');
    expect(e.envelope).toHaveProperty('RecordId');
    expect(e.ts).toBe('2026-03-02T07:15:00.000Z');
  });

  it('handles Search-UnifiedAuditLog Export-Csv with numeric record type and mail items', () => {
    const ad = { Id: 'x', RecordType: 50, CreationTime: '2026-03-02T07:15:00', Operation: 'MailItemsAccessed', Workload: 'Exchange', UserId: 'bo@contoso.com', ClientIPAddress: '203.0.113.9', MailboxOwnerUPN: 'ceo@contoso.com', OperationProperties: [{ Name: 'MailAccessType', Value: 'Bind' }, { Name: 'IsThrottled', Value: 'False' }], Folders: [{ Path: '\\Inbox', FolderItems: [{ Subject: 'Invoice 1', InternetMessageId: '<a@b>' }, { Subject: 'Invoice 2' }] }] };
    const row = { RunspaceId: 'r', RecordType: '50', CreationDate: '3/2/2026 7:15:00 AM', UserIds: 'bo@contoso.com', Operations: 'MailItemsAccessed', AuditData: JSON.stringify(ad), ResultIndex: 1, ResultCount: 1, Identity: 'x', IsValid: 'True', ObjectState: 'Unchanged' };
    const f = detectFormat([row]);
    expect(f.label).toBe('Search-UnifiedAuditLog export');
    const [e] = createNormalizer(f)(row);
    expect(e.recordType).toBe('ExchangeItemAggregated');
    expect(e.kind).toBe('mail');
    expect(e.item).toBe('Invoice 1 (+1 more)');
    expect(e.counterpart).toBe('ceo@contoso.com');
    expect(e.messageId).toBe('a@b');
  });

  it('handles an Entra sign-in CSV', () => {
    const row = { 'Date (UTC)': '2026-03-02T07:15:00Z', 'Request ID': 'rq1', 'User agent': 'Mozilla/5.0 Chrome/120', 'Correlation ID': 'c1', 'User': 'Anna', 'Username': 'anna@contoso.com', 'Application': 'Office 365 Exchange Online', 'Resource': 'Microsoft Graph', 'IP address': '198.51.100.7', 'Location': 'Copenhagen, Capital Region, DK', 'Status': 'Failure', 'Sign-in error code': '50126', 'Failure reason': 'Invalid username or password', 'Client app': 'Browser', 'Multifactor authentication result': '', 'Conditional Access': 'Not Applied', 'Session ID': 's1' };
    const f = detectFormat([row]);
    expect(f.source).toBe('entra_signin');
    const [e] = createNormalizer(f)(row);
    expect(e.operation).toBe('UserLoginFailed');
    expect(e.failed).toBe(true);
    expect(e.sourceRecordId).toBe('rq1');
    expect(e.detail).toContain('Invalid username or password');
  });

  it('handles Graph signIn JSON', () => {
    const row = { id: 'g1', createdDateTime: '2026-03-02T07:15:00Z', userPrincipalName: 'anna@contoso.com', appDisplayName: 'Teams', ipAddress: '198.51.100.7', status: { errorCode: 0, failureReason: 'Other.' }, location: { city: 'Aarhus', state: 'Midtjylland', countryOrRegion: 'DK' }, deviceDetail: { browser: 'Edge 120', operatingSystem: 'Windows 11' }, isInteractive: false, conditionalAccessStatus: 'success' };
    const f = detectFormat([row]);
    expect(f.source).toBe('entra_signin');
    const [e] = createNormalizer(f)(row);
    expect(e.result).toBe('Success');
    expect(e.recordType).toBe('EntraNonInteractiveSignIn');
    expect(e.userAgent).toBe('Edge 120 / Windows 11');
  });

  it('splits an enhanced-summary message trace by recipient', () => {
    const row = { origin_timestamp_utc: '2026-03-02T07:15:00Z', sender_address: 'x@evil.com', recipient_status: 'anna@contoso.com##Receive, Deliver;bo@contoso.com##Receive, Fail', message_subject: 'Urgent', total_bytes: '2048', message_id: '<m1@evil.com>', network_message_id: 'n1', original_client_ip: '203.0.113.1', directionality: 'Incoming', connector_id: '', delivery_priority: 'Normal' };
    const f = detectFormat([row]);
    expect(f.source).toBe('message_trace');
    const ev = createNormalizer(f)(row);
    expect(ev).toHaveLength(2);
    expect(ev[0].result).toBe('Delivered');
    expect(ev[1].failed).toBe(true);
    expect(ev[0].messageId).toBe('m1@evil.com');
  });

  it('routes the Defender union export by table', () => {
    const f = detectFormat([{ Table: 'UrlClickEvents', Timestamp: '', Url: '', ActionType: '', AccountUpn: '', NetworkMessageId: '', RecipientEmailAddress: '', IsClickedThrough: '', IPAddress: '' }]);
    expect(f.columns.__sub).toBe('union');
    const [e] = createNormalizer(f)({ Table: 'UrlClickEvents', Timestamp: '2026-03-02T07:15:00Z', Url: 'https://bad.example/x', ActionType: 'ClickAllowed', AccountUpn: 'anna@contoso.com', NetworkMessageId: 'n1', IsClickedThrough: 'True', IPAddress: '198.51.100.7' });
    expect(e.source).toBe('defender_url_click');
    expect(e.result).toBe('Allowed (clicked through warning)');
  });
});

suite('query parser', () => {
  it('parses fields, negation, OR and raw paths', () => {
    const q = parseQuery('user:anna* -owner:m365 Parameters.ForwardTo:* "exact phrase" OR op:userloginfailed ts:>2026-01-01');
    expect(q.groups).toHaveLength(2);
    expect(q.groups[0][0]).toMatchObject({ field: 'user', value: 'anna*' });
    expect(q.groups[0][1]).toMatchObject({ field: 'owner', negate: true });
    expect(q.groups[0][2]).toMatchObject({ path: ['Parameters', 'ForwardTo'], value: '*' });
    expect(q.groups[0][3]).toMatchObject({ field: null, quoted: true, value: 'exact phrase' });
    expect(q.groups[1][1]).toMatchObject({ field: 'ts', cmp: '>', value: '2026-01-01' });
  });
});

suite('ip enrichment', () => {
  it('cleans and classifies', () => {
    expect(cleanIp('[2603:1006::5]:443')).toBe('2603:1006::5');
    expect(ownerOf('10.1.2.3')?.category).toBe('priv');
    expect(ownerOf('40.126.0.5')?.category).toMatch(/m365|azure|msnet/);
    expect(ownerOf('2603:1006::5')?.category).toBe('m365');
    expect(typeof countryOf('8.8.8.8')).toBe('string');
    expect(countryOf('8.8.8.8')).toBe('US');
  });
});

import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// four things in the spec can't be done directly and have to be asked for. they share one
// record shape and one requests.json file, because approve/reject/reason work identically for
// all of them and only the action taken on approval differs.
//   group-create    a user asks the super admin for a group, supplying the details up front
//   group-delete    a group admin asks the super admin to delete or disband their group
//   channel-create  a member proposes a room, the group's admin approves or rejects it
//   user-ban        a group admin reports a user, the super admin actions the permanent ban
export type RequestType = 'group-create' | 'group-delete' | 'channel-create' | 'user-ban';

export interface AppRequest {
  id: string;
  type: RequestType;
  status: 'pending' | 'approved' | 'rejected';   // there's no 'cancelled', the spec says a pending request can't be withdrawn
  summary: string;          // the wording is built once on the server so every queue renders the same sentence
  requestedBy: string;
  groupId: string;          // empty on group-create, because the group doesn't exist yet
  payload: any;             // the type specific detail: a group's fields, a room name, or the reported email + reason
  createdAt: string;        // ISO, so sorting the strings and sorting the dates agree
  resolvedAt: string;
  resolvedBy: string;
  reason: string;           // only filled in on a rejection, which the spec requires a reason for
}

// one row of the super admin's audit log
export interface AuditEntry {
  id: string;
  at: string;
  type: string;
  actor: string;
  detail: string;
}

// a permanently banned account. the user record itself is deleted, this is what's left, and
// it's what stops the email ever being registered again.
export interface BannedUser {
  email: string;
  reason: string;
  reportedBy: string;
  bannedAt: string;
  bannedBy: string;
}

@Service()
export class RequestService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  // GET /requests with any combination of filters. scope is the useful one: 'super' returns the
  // three types the super admin actions, 'group' returns the ones a group admin actions, so
  // neither page has to know which types belong in which queue.
  getRequests(filters: { status?: string; type?: string; groupId?: string; requestedBy?: string; scope?: string } = {}) {
    // undefined values would be sent as the string "undefined", so they're dropped first
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        params[key] = value;
      }
    });
    return this.http.get<AppRequest[]>(`${this.apiUrl}/requests`, { params });
  }

  // POST /requests. the server validates per type — a duplicate group name, a room that already
  // exists, a ban report with no reason and a report against a group's only admin are all refused.
  raise(type: RequestType, requestedBy: string, payload: any, groupId = '') {
    return this.http.post<AppRequest>(`${this.apiUrl}/requests`, { type, requestedBy, groupId, payload });
  }

  // POST /requests/:id/approve. carrying out the request happens on the server, so approving a
  // group-create really creates the group and approving a user-ban really deletes the account.
  approve(requestId: string, actorEmail: string) {
    return this.http.post<AppRequest>(`${this.apiUrl}/requests/${requestId}/approve`, { actorEmail });
  }

  // POST /requests/:id/reject. reason isn't optional — the server answers 400 without one.
  reject(requestId: string, actorEmail: string, reason: string) {
    return this.http.post<AppRequest>(`${this.apiUrl}/requests/${requestId}/reject`, { actorEmail, reason });
  }

  getBans() {                       // GET /bans, every permanently banned account system wide
    return this.http.get<BannedUser[]>(`${this.apiUrl}/bans`);
  }

  // GET /audit?type=... the filtering and the newest-first ordering both happen on the server
  getAudit(type = '') {
    return this.http.get<AuditEntry[]>(`${this.apiUrl}/audit`, { params: type ? { type } : {} });
  }

  // GET /audit/types, the distinct types actually in the log. the filter dropdown is built from
  // this rather than a hardcoded list, so it can't drift out of date as new actions are logged.
  getAuditTypes() {
    return this.http.get<string[]>(`${this.apiUrl}/audit/types`);
  }
}

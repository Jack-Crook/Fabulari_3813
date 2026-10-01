import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// the four actions that need a request:
//   group-create    user -> super admin
//   group-delete    group admin -> super admin
//   channel-create  member -> group admin
//   user-ban        group admin reports -> super admin bans permanently
export type RequestType = 'group-create' | 'group-delete' | 'channel-create' | 'user-ban';

export interface AppRequest {
  _id: string;
  type: RequestType;
  status: 'pending' | 'approved' | 'rejected';   // no cancelling
  summary: string;          // the sentence every queue shows, built on the server
  requestedBy: string;
  groupId: string | null;   // null on group-create, the group doesn't exist yet
  payload: any;             // per type: group fields, room name, or reported email + reason
  createdAt: string;        // ISO
  resolvedAt: string;
  resolvedBy: string;
  reason: string;           // set on rejection
}

// one row of the super admin's audit log
export interface AuditEntry {
  _id: string;
  at: string;
  type: string;
  actor: string;
  detail: string;
}

// a permanently banned account. the user is deleted, this record blocks the email forever.
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

  // GET /requests with filters. scope 'super' or 'group' picks the right queue's types.
  getRequests(filters: { status?: string; type?: string; groupId?: string; requestedBy?: string; scope?: string } = {}) {
    // drop empty values, or they'd be sent as "undefined"
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        params[key] = value;
      }
    });
    return this.http.get<AppRequest[]>(`${this.apiUrl}/requests`, { params });
  }

  // POST /requests, validated per type on the server
  raise(type: RequestType, requestedBy: string, payload: any, groupId = '') {
    return this.http.post<AppRequest>(`${this.apiUrl}/requests`, { type, requestedBy, groupId, payload });
  }

  // POST /requests/:id/approve. the server carries the request out.
  approve(requestId: string, actorEmail: string) {
    return this.http.post<AppRequest>(`${this.apiUrl}/requests/${requestId}/approve`, { actorEmail });
  }

  // POST /requests/:id/reject. reason required (400 without).
  reject(requestId: string, actorEmail: string, reason: string) {
    return this.http.post<AppRequest>(`${this.apiUrl}/requests/${requestId}/reject`, { actorEmail, reason });
  }

  getBans() {                       // GET /bans
    return this.http.get<BannedUser[]>(`${this.apiUrl}/bans`);
  }

  // GET /audit?type=, filtered and sorted on the server
  getAudit(type = '') {
    return this.http.get<AuditEntry[]>(`${this.apiUrl}/audit`, { params: type ? { type } : {} });
  }

  // GET /audit/types, the types in the log, for the filter dropdown
  getAuditTypes() {
    return this.http.get<string[]>(`${this.apiUrl}/audit/types`);
  }
}

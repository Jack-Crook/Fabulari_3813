import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth, AppUser } from '../auth';
import { GroupService, Group } from '../group';
import { RequestService, AppRequest, AuditEntry, BannedUser } from '../request';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [Navbar, FormsModule, DatePipe],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  private auth = inject(Auth);
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);

  me = this.auth.email;   // sent as actorEmail on every approve and reject so the server can check the role

  // all four panels are signals, because every one is filled from a subscribe callback and the
  // app is zoneless — a plain array would be set but never drawn
  pendingRequests = signal<AppRequest[]>([]);
  users = signal<AppUser[]>([]);
  groups = signal<Group[]>([]);
  bannedUsers = signal<BannedUser[]>([]);
  auditLog = signal<AuditEntry[]>([]);
  auditTypes = signal<string[]>([]);

  // the spec asks for an audit log filterable by type. the filtering happens on the server, so
  // changing this refetches rather than hiding rows the client already has.
  auditFilter = signal('');

  actionError = signal('');
  actionSuccess = signal('');

  // only one request has its reject box open at a time, so this holds that request's id
  rejectingId = signal('');
  rejectReason = '';        // plain property, [(ngModel)] writes it from a DOM event

  constructor() {
    this.load();
  }

  private load() {
    // scope: 'super' returns only the three types the super admin actions — group creations,
    // group deletions and ban reports. room proposals go to the group's own admin instead.
    this.requestService.getRequests({ status: 'pending', scope: 'super' })
      .subscribe(requests => this.pendingRequests.set(requests));

    this.auth.getUsers().subscribe(users => this.users.set(users));
    this.groupService.getGroups().subscribe(groups => this.groups.set(groups));
    this.requestService.getBans().subscribe(bans => this.bannedUsers.set(bans));
    this.requestService.getAuditTypes().subscribe(types => this.auditTypes.set(types));
    this.loadAudit();
  }

  private loadAudit() {
    this.requestService.getAudit(this.auditFilter()).subscribe(entries => this.auditLog.set(entries));
  }

  onFilterAudit(type: string) {
    this.auditFilter.set(type);
    this.loadAudit();
  }

  private clearMessages() {
    this.actionError.set('');
    this.actionSuccess.set('');
  }

  private showError(err: HttpErrorResponse) {
    this.actionError.set(err.error?.error ?? 'Something went wrong, please try again.');
  }

  // how many groups this account is a member of, shown next to them in the members panel.
  // group admin isn't a role on the user, so this is the only way to say anything about their
  // relationship to groups from a user record.
  groupCountFor(email: string) {
    return this.groups().filter(g => g.memberEmails.includes(email)).length;
  }

  adminCountFor(email: string) {
    return this.groups().filter(g => g.adminEmails.includes(email)).length;
  }

  // approving is what actually carries the request out: a group-create really creates the
  // group with the requester as its first admin, a group-delete removes the group and its
  // rooms, and a user-ban deletes the account and blacklists the email permanently.
  onApprove(request: AppRequest) {
    this.clearMessages();

    this.requestService.approve(request.id, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`Approved: ${request.summary}`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startRejecting(request: AppRequest) {
    this.rejectingId.set(request.id);
    this.rejectReason = '';
    this.clearMessages();
  }

  cancelRejecting() {
    this.rejectingId.set('');
  }

  // a rejection must carry a reason. the server answers 400 without one, and the requester
  // reads that reason on their own profile page.
  onReject(request: AppRequest) {
    this.clearMessages();

    this.requestService.reject(request.id, this.me, this.rejectReason).subscribe({
      next: () => {
        this.actionSuccess.set(`Rejected: ${request.summary}`);
        this.rejectingId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // request types are stored as slugs, this is the readable label for the queue
  labelFor(type: string) {
    const labels: Record<string, string> = {
      'group-create': 'New group',
      'group-delete': 'Delete group',
      'user-ban': 'Permanent ban',
    };
    return labels[type] ?? type;
  }
}

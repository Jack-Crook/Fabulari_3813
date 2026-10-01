import { Component, inject, signal, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Autofocus } from '../autofocus';
import { Auth, AppUser } from '../auth';
import { GroupService, Group } from '../group';
import { RequestService, AppRequest, AuditEntry, BannedUser, AUDIT_PAGE } from '../request';
import { ChatService } from '../chat';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [Navbar, FormsModule, DatePipe, Autofocus],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  private auth = inject(Auth);
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);

  me = this.auth.email;   // sent as actorEmail so the server can check the role

  // signals, since they're set in subscribe and the app is zoneless
  pendingRequests = signal<AppRequest[]>([]);
  users = signal<AppUser[]>([]);
  groups = signal<Group[]>([]);
  bannedUsers = signal<BannedUser[]>([]);
  auditLog = signal<AuditEntry[]>([]);
  moreAudit = signal(false);       // a full page came back, so there may be older entries
  auditTypes = signal<string[]>([]);

  // filtering happens on the server, so changing this refetches
  auditFilter = signal('');

  actionError = signal('');
  actionSuccess = signal('');

  // the request with its reject box open
  rejectingId = signal('');

  // the request waiting on "are you sure?". only bans and group deletions ask, they can't be undone.
  confirmingId = signal('');
  rejectReason = '';        // plain, [(ngModel)] writes it

  constructor() {
    this.load();

    // live: a request raised or actioned anywhere refreshes this page. stops
    // listening when the page goes.
    const stop = inject(ChatService).onRequestsChanged(() => this.load());
    inject(DestroyRef).onDestroy(stop);
  }

  private load() {
    // only the super admin's request types. room proposals go to group admins.
    this.requestService.getRequests({ status: 'pending', scope: 'super' })
      .subscribe(requests => this.pendingRequests.set(requests));

    this.auth.getUsers().subscribe(users => this.users.set(users));
    this.groupService.getGroups().subscribe(groups => this.groups.set(groups));
    this.requestService.getBans().subscribe(bans => this.bannedUsers.set(bans));
    this.requestService.getAuditTypes().subscribe(types => this.auditTypes.set(types));
    this.loadAudit();
  }

  // the newest page, starting again from the top
  private loadAudit() {
    this.requestService.getAudit(this.auditFilter()).subscribe(entries => {
      this.auditLog.set(entries);
      this.moreAudit.set(entries.length === AUDIT_PAGE);
    });
  }

  // the next page, added under the ones already shown. the log can grow without limit, so it's
  // read a page at a time instead of all at once.
  onShowOlderAudit() {
    this.requestService.getAudit(this.auditFilter(), this.auditLog().length).subscribe(entries => {
      this.auditLog.update(shown => [...shown, ...entries]);
      this.moreAudit.set(entries.length === AUDIT_PAGE);
    });
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

  // group and admin counts for the members panel (stored on groups, not users)
  groupCountFor(email: string) {
    return this.groups().filter(g => g.memberEmails.includes(email)).length;
  }

  adminCountFor(email: string) {
    return this.groups().filter(g => g.adminEmails.includes(email)).length;
  }

  needsConfirm(request: AppRequest) {
    return request.type === 'user-ban' || request.type === 'group-delete';
  }

  // what the confirm box says will happen
  consequenceOf(request: AppRequest) {
    return request.type === 'user-ban'
      ? `This deletes ${request.payload.email}'s account and their email can never register again.`
      : 'This deletes the group, all of its rooms and every message in them.';
  }

  // Approve: irreversible types confirm first, the rest go straight through
  onApproveClicked(request: AppRequest) {
    if (this.needsConfirm(request)) {
      this.confirmingId.set(request._id);
      this.rejectingId.set('');
      this.clearMessages();
      return;
    }
    this.onApprove(request);
  }

  // the server carries the request out (creates the group, deletes it, or bans the user)
  onApprove(request: AppRequest) {
    this.clearMessages();

    this.requestService.approve(request._id, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`Approved: ${request.summary}`);
        this.confirmingId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startRejecting(request: AppRequest) {
    this.rejectingId.set(request._id);
    this.confirmingId.set('');
    this.rejectReason = '';
    this.clearMessages();
  }

  cancelRejecting() {
    this.rejectingId.set('');
  }

  // a reason is required (400 without), the requester sees it on their profile
  onReject(request: AppRequest) {
    this.clearMessages();

    if (!this.rejectReason.trim()) {
      this.actionError.set('A reason is required when rejecting a request');
      return;
    }

    this.requestService.reject(request._id, this.me, this.rejectReason).subscribe({
      next: () => {
        this.actionSuccess.set(`Rejected: ${request.summary}`);
        this.rejectingId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // readable label for a request type
  labelFor(type: string) {
    const labels: Record<string, string> = {
      'group-create': 'New group',
      'group-delete': 'Delete group',
      'user-ban': 'Permanent ban',
    };
    return labels[type] ?? type;
  }
}

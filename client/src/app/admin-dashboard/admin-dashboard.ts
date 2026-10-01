import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Autofocus } from '../autofocus';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';
import { RequestService, AppRequest } from '../request';

@Component({
  selector: 'app-admin-dashboard',
  imports: [Navbar, FormsModule, DatePipe, Autofocus],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard {
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(Auth);

  private groupId = '';           // for reloading after an edit
  me = this.auth.email;           // sent as actorEmail so the server can check I'm an admin here

  // signals, because they're set inside subscribe callbacks and this app is zoneless
  group = signal<Group | undefined>(undefined);   // the group in the url
  channels = signal<Channel[]>([]);
  proposals = signal<AppRequest[]>([]);           // pending room proposals

  newRoomName = '';               // plain, [(ngModel)] writes it

  // one message bar for the page
  actionError = signal('');
  actionSuccess = signal('');

  // settings form, opened pre-filled with the saved values
  editingSettings = signal(false);
  formName = '';
  formDescription = '';
  formAgeLimit = 0;
  formTheme = '#5FA8D3';

  // only one row is open at a time, so each holds that row's id
  renamingChannelId = signal('');
  renameValue = '';

  banningEmail = signal('');       // the member with the ban/report box open
  banReason = '';

  // "are you sure?" for deleting a room (takes its messages) and removing a member
  confirmingDeleteId = signal('');
  confirmingRemoveEmail = signal('');

  rejectingId = signal('');        // the proposal with the reject box open
  rejectReason = '';               // required for a rejection

  constructor() {
    // subscribed, so switching between groups you admin reloads
    this.route.paramMap.subscribe(params => {
      this.groupId = params.get('groupId') ?? '';
      this.load();
    });
  }

  private load() {
    this.groupService.getGroups().subscribe(groups => {
      this.group.set(groups.find(g => g._id === this.groupId));
    });

    this.groupService.getChannels(this.groupId).subscribe(channels => {
      this.channels.set(channels);
    });

    // only the group admin's request types
    this.requestService.getRequests({ groupId: this.groupId, status: 'pending', scope: 'group' })
      .subscribe(requests => this.proposals.set(requests));
  }

  // admin = email in adminEmails, there's no per-member role
  roleOf(email: string) {
    return this.group()?.adminEmails.includes(email) ? 'Admin' : 'Member';
  }

  isAdmin(email: string) {
    return this.group()?.adminEmails.includes(email) ?? false;
  }

  // a group always keeps an admin. the server answers 409, this just greys out the buttons.
  isLastAdmin(email: string) {
    const group = this.group();
    return !!group && group.adminEmails.includes(email) && group.adminEmails.length === 1;
  }

  private clearMessages() {
    this.actionError.set('');
    this.actionSuccess.set('');
  }

  // the server's { error } body
  private showError(err: HttpErrorResponse) {
    this.actionError.set(err.error?.error ?? 'Something went wrong, please try again.');
  }

  // group settings

  startEditingSettings() {
    const group = this.group();
    this.formName = group?.name ?? '';
    this.formDescription = group?.description ?? '';
    this.formAgeLimit = group?.ageLimit ?? 0;
    this.formTheme = group?.theme ?? '#5FA8D3';
    this.clearMessages();
    this.editingSettings.set(true);
  }

  // no request needed to edit settings
  onSaveSettings() {
    this.clearMessages();

    const changes = {
      name: this.formName,
      description: this.formDescription,
      ageLimit: Number(this.formAgeLimit),
      theme: this.formTheme,
    };

    this.groupService.updateGroup(this.groupId, changes, this.me).subscribe({
      next: result => {
        // raising the age limit removes under-age members, and the server says who
        this.actionSuccess.set(result.booted.length
          ? `Group updated. ${result.booted.length} member(s) removed under the new age limit: ${result.booted.join(', ')}`
          : 'Group updated.');
        this.editingSettings.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // a group admin can't delete their group, so this asks the super admin
  onRequestDeletion() {
    this.clearMessages();

    this.requestService.raise('group-delete', this.me, {}, this.groupId).subscribe({
      next: () => this.actionSuccess.set('Deletion requested. The super admin will review it.'),
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // rooms

  onAddRoom() {                     // POST /channels
    this.clearMessages();

    this.groupService.createChannel(this.groupId, this.newRoomName, this.me).subscribe({
      next: created => {
        this.actionSuccess.set(`Room "${created.name}" created.`);
        this.newRoomName = '';
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startRenaming(channel: Channel) {
    this.renamingChannelId.set(channel._id);
    this.renameValue = channel.name;
    this.clearMessages();
  }

  onRenameRoom(channel: Channel) {  // PATCH /channels/:id
    this.clearMessages();

    this.groupService.renameChannel(channel._id, this.renameValue, this.me).subscribe({
      next: updated => {
        this.actionSuccess.set(`Room renamed to "${updated.name}".`);
        this.renamingChannelId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startDeleting(channel: Channel) {
    this.confirmingDeleteId.set(channel._id);
    this.clearMessages();
  }

  onDeleteRoom(channel: Channel) {  // DELETE /channels/:id, from the confirm box
    this.clearMessages();

    this.groupService.deleteChannel(channel._id, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`Room "${channel.name}" deleted.`);
        this.confirmingDeleteId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // members

  // removes from this group only. 409 if it would leave no admin.
  startRemoving(email: string) {
    this.confirmingRemoveEmail.set(email);
    this.banningEmail.set('');       // one box open at a time
    this.clearMessages();
  }

  onRemoveMember(email: string) {
    this.clearMessages();

    this.groupService.removeMember(this.groupId, email, this.me).subscribe({
      next: () => {
        // leaving yourself: this page is for admins of the group, and you're not even a member now
        if (email === this.me) {
          this.router.navigate(['/user-dashboard']);
          return;
        }
        this.actionSuccess.set(`${email} removed from this group.`);
        this.confirmingRemoveEmail.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  onPromote(email: string) {
    this.clearMessages();

    this.groupService.promoteAdmin(this.groupId, email, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`${email} is now an admin of this group.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // demote or step down, same call. refused for the last admin.
  onDemote(email: string) {
    this.clearMessages();

    this.groupService.demoteAdmin(this.groupId, email, this.me).subscribe({
      next: () => {
        // stepping down: every control on this page would now answer 403, so go back to the
        // group, where you're still a member
        if (email === this.me) {
          this.router.navigate(['/groups', this.groupId]);
          return;
        }
        this.actionSuccess.set(`${email} is no longer an admin of this group.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startBanning(email: string) {
    this.banningEmail.set(email);
    this.confirmingRemoveEmail.set('');
    this.banReason = '';
    this.clearMessages();
  }

  cancelBanning() {
    this.banningEmail.set('');
  }

  // group ban: removes them and stops them rejoining. can be lifted.
  onBanFromGroup(email: string) {
    this.clearMessages();

    this.groupService.banFromGroup(this.groupId, email, this.banReason, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`${email} is banned from this group.`);
        this.banningEmail.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  onLiftBan(email: string) {
    this.clearMessages();

    this.groupService.liftGroupBan(this.groupId, email, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`Ban on ${email} lifted.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // reports a user to the super admin for a permanent ban. needs a reason, and is refused if
  // the user is a group's only admin.
  onReportUser(email: string) {
    this.clearMessages();

    this.requestService.raise('user-ban', this.me, { email, reason: this.banReason }, this.groupId).subscribe({
      next: () => {
        this.actionSuccess.set(`${email} reported to the super admin for a permanent ban.`);
        this.banningEmail.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // room proposals from members

  onApproveProposal(request: AppRequest) {
    this.clearMessages();

    this.requestService.approve(request._id, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`Approved: ${request.summary}`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startRejecting(request: AppRequest) {
    this.rejectingId.set(request._id);
    this.rejectReason = '';
    this.clearMessages();
  }

  cancelRejecting() {
    this.rejectingId.set('');
  }

  // a reason is required (400 without)
  onRejectProposal(request: AppRequest) {
    this.clearMessages();

    this.requestService.reject(request._id, this.me, this.rejectReason).subscribe({
      next: () => {
        this.actionSuccess.set(`Rejected: ${request.summary}`);
        this.rejectingId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }
}

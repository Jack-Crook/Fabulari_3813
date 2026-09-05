import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';                // lets the html use [(ngModel)] on the add room input
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';
import { RequestService, AppRequest } from '../request';

@Component({
  selector: 'app-admin-dashboard',
  imports: [Navbar, FormsModule, DatePipe],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard {
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);

  private groupId = '';           // kept so the panels can reload after an edit without re-reading the url
  me = this.auth.email;           // every write endpoint takes this as actorEmail so the server can check the caller is really an admin here

  // signals, because they're set inside subscribe callbacks and this app is zoneless
  group = signal<Group | undefined>(undefined);   // the group whose id is in the url
  channels = signal<Channel[]>([]);               // its rooms, so a newly added one shows up straight away
  proposals = signal<AppRequest[]>([]);           // room proposals from members, waiting on this admin

  newRoomName = '';               // plain property, [(ngModel)] writes it from a DOM event

  // shared feedback for every action on the page
  actionError = signal('');
  actionSuccess = signal('');

  // the group settings form. it opens pre-filled with what's stored, so saving without changing
  // anything writes back the same values rather than blanking them.
  editingSettings = signal(false);
  formName = '';
  formDescription = '';
  formAgeLimit = 0;
  formTheme = '#5FA8D3';

  // only one row is ever renaming, banning or being rejected at a time, so each of these holds
  // the id of that row rather than every row carrying its own open/closed flag
  renamingChannelId = signal('');
  renameValue = '';

  banningEmail = signal('');       // which member the ban/report box is open for
  banReason = '';

  rejectingId = signal('');        // which proposal the reject box is open for
  rejectReason = '';               // the spec says a rejection must carry a reason, so this can't be skipped

  constructor() {
    // subscribed rather than read once, so switching between two groups you admin reloads
    this.route.paramMap.subscribe(params => {
      this.groupId = params.get('groupId') ?? '';
      this.load();
    });
  }

  private load() {
    this.groupService.getGroups().subscribe(groups => {
      this.group.set(groups.find(g => g.id === this.groupId));
    });

    this.groupService.getChannels(this.groupId).subscribe(channels => {
      this.channels.set(channels);
    });

    // scope: 'group' asks the server for the request types a group admin actions rather than
    // the ones that go to the super admin, so this page doesn't have to know which is which
    this.requestService.getRequests({ groupId: this.groupId, status: 'pending', scope: 'group' })
      .subscribe(requests => this.proposals.set(requests));
  }

  // admins are just the members whose email is in adminEmails, there's no role stored per member
  roleOf(email: string) {
    return this.group()?.adminEmails.includes(email) ? 'Admin' : 'Member';
  }

  isAdmin(email: string) {
    return this.group()?.adminEmails.includes(email) ?? false;
  }

  // the spec says a group must always keep at least one admin, so the last one can't be
  // demoted, removed or banned. the server enforces it with a 409 either way — this just
  // greys the buttons out so it isn't a surprise.
  isLastAdmin(email: string) {
    const group = this.group();
    return !!group && group.adminEmails.includes(email) && group.adminEmails.length === 1;
  }

  private clearMessages() {
    this.actionError.set('');
    this.actionSuccess.set('');
  }

  // express sends its errors as { error: '...' }, and that body arrives on err.error
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

  // no request needed for this. the spec is explicit that a group admin can change the name,
  // description, theme and age limit whenever they like — only creating and deleting a group
  // go to the super admin.
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
        // raising the age limit automatically removes members who no longer meet it, so the
        // server sends back who went and the admin is told rather than finding out later
        this.actionSuccess.set(result.booted.length
          ? `Group updated. ${result.booted.length} member(s) removed under the new age limit: ${result.booted.join(', ')}`
          : 'Group updated.');
        this.editingSettings.set(false);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // deleting a group is the one thing a group admin can't do themself. this raises the request
  // and the super admin actions it. it's also how a group with no working admin gets disbanded.
  onRequestDeletion() {
    this.clearMessages();

    this.requestService.raise('group-delete', this.me, {}, this.groupId).subscribe({
      next: () => this.actionSuccess.set('Deletion requested. The super admin will review it.'),
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // rooms

  onAddRoom() {                     // POST /channels, the room appears in the group view too
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
    this.renamingChannelId.set(channel.id);
    this.renameValue = channel.name;
    this.clearMessages();
  }

  onRenameRoom(channel: Channel) {  // PATCH /channels/:id, the spec allows an admin to fix a room's name
    this.clearMessages();

    this.groupService.renameChannel(channel.id, this.renameValue, this.me).subscribe({
      next: updated => {
        this.actionSuccess.set(`Room renamed to "${updated.name}".`);
        this.renamingChannelId.set('');
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  onDeleteRoom(channel: Channel) {  // DELETE /channels/:id
    this.clearMessages();

    this.groupService.deleteChannel(channel.id, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`Room "${channel.name}" deleted.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // members

  // group level removal, not a system wide ban. the server refuses with a 409 if this would
  // leave the group without an admin, and that message is what ends up in actionError.
  onRemoveMember(email: string) {
    this.clearMessages();

    this.groupService.removeMember(this.groupId, email, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(`${email} removed from this group.`);
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

  // the same call whether an admin is demoting someone else or stepping down themself — the
  // spec treats both the same way, and both are refused if they'd leave the group adminless
  onDemote(email: string) {
    this.clearMessages();

    this.groupService.demoteAdmin(this.groupId, email, this.me).subscribe({
      next: () => {
        this.actionSuccess.set(email === this.me
          ? 'You are no longer an admin of this group.'
          : `${email} is no longer an admin of this group.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  startBanning(email: string) {
    this.banningEmail.set(email);
    this.banReason = '';
    this.clearMessages();
  }

  cancelBanning() {
    this.banningEmail.set('');
  }

  // group level ban. stronger than Remove because it also stops them rejoining, but the
  // account still exists and they keep every other group. this one can be lifted again.
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

  // a system wide ban is permanent and only the super admin can do it, and only from a group
  // admin's report — the spec says an admin can't ban directly without a prior report. this is
  // that report. the server refuses one without a reason, and refuses one against a user who is
  // some other group's only admin until a replacement is assigned there.
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

  // room proposals raised by members of this group

  onApproveProposal(request: AppRequest) {
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

  // the reason isn't optional. the server answers 400 without one, so the box has to be filled
  // in before this does anything — which is the spec's rule, enforced rather than suggested.
  onRejectProposal(request: AppRequest) {
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
}

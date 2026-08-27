import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';                // lets the html use [(ngModel)] on the add room input
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { GroupService, Group, Channel } from '../group';

@Component({
  selector: 'app-admin-dashboard',
  imports: [Navbar, FormsModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard {
  private groupService = inject(GroupService);
  private route = inject(ActivatedRoute);

  private groupId = '';           // kept so the panels can reload after an edit without re-reading the url

  // signals, because they're set inside subscribe callbacks and this app is zoneless
  group = signal<Group | undefined>(undefined);   // the group whose id is in the url
  channels = signal<Channel[]>([]);               // its rooms, so a newly added one shows up straight away

  newRoomName = '';               // plain property, [(ngModel)] writes it from a DOM event

  // shared feedback for adding a room, deleting one, and removing a member
  actionError = signal('');
  actionSuccess = signal('');

  // join requests aren't stored anywhere, there's no requests endpoint yet, so these stay mock
  joinRequests = [
    { email: 'newperson@example.com' },
    { email: 'someone@example.com' },
    { email: 'third@example.com' },
  ];

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
  }

  // admins are just the members whose email is in adminEmails, there's no role stored per member
  roleOf(email: string) {
    return this.group()?.adminEmails.includes(email) ? 'Admin' : 'Member';
  }

  private clearMessages() {
    this.actionError.set('');
    this.actionSuccess.set('');
  }

  // express sends its errors as { error: '...' }, and that body arrives on err.error
  private showError(err: HttpErrorResponse) {
    this.actionError.set(err.error?.error ?? 'Something went wrong, please try again.');
  }

  onAddRoom() {                     // POST /channels, the room appears in the group view too
    this.clearMessages();

    this.groupService.createChannel(this.groupId, this.newRoomName).subscribe({
      next: created => {
        this.actionSuccess.set(`Room "${created.name}" created.`);
        this.newRoomName = '';
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  onDeleteRoom(channel: Channel) {  // DELETE /channels/:id
    this.clearMessages();

    this.groupService.deleteChannel(channel.id).subscribe({
      next: () => {
        this.actionSuccess.set(`Room "${channel.name}" deleted.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }

  // group level removal, not a system wide ban. the server refuses with a 409 if this would
  // leave the group without an admin, and that message is what ends up in actionError.
  onRemoveMember(email: string) {
    this.clearMessages();

    this.groupService.removeMember(this.groupId, email).subscribe({
      next: () => {
        this.actionSuccess.set(`${email} removed from this group.`);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.showError(err),
    });
  }
}

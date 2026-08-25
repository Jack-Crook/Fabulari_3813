import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatRoom } from './chat-room';

describe('ChatRoom', () => {
  let component: ChatRoom;
  let fixture: ComponentFixture<ChatRoom>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatRoom],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatRoom);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

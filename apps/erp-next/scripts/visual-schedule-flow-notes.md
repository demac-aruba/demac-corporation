# Visual Schedule Picker acceptance scope

This branch addresses three production observations from Scheduling & Dispatch:

1. Half-day Vans must never display post-shift slots as Open in the visual capacity picker.
2. Day-to-day navigation should reuse cached/prefetched live schedule context instead of blanking the entire modal while every dependency reloads.
3. Normal appointment Reschedule must use the same Booking Authority-backed Visual Capacity picker as Remaining Work, preserving the original appointment/Work Order relationship.

Booking Authority remains the only capacity authority. The live grid is context; only returned complete-match options are selectable.

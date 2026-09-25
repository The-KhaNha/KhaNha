-- Human-readable order numbers should look like #1001, #1002, ... rather than #1.
ALTER SEQUENCE "Order_orderNumber_seq" RESTART WITH 1001;
